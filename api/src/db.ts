import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { AssignableRole, BudgetSection, HeadGroup, Role } from '@ffos/shared';
import { env } from './env.ts';

// ── document types ──

interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDoc extends Timestamps {
  _id: ObjectId;
  name: string;
  phone: string;
  email?: string;
  passwordHash: string;
  isInstanceOwner: boolean;
  recoveryCodeHashes: string[];
  disabledAt?: Date;
  /** Which reminders to push; unset means both on. */
  notify?: { bills: boolean; budget: boolean };
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  refreshTokenHash: string;
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

/** A one-time password reset link made by the instance owner. */
export interface PasswordResetDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

/** A browser that agreed to receive notifications for this person. */
export interface PushSubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  createdAt: Date;
}

/** A reminder already sent, so the same one isn't sent again (expires on its own). */
export interface PushLogDoc {
  _id: string;
  expiresAt: Date;
}

/** Writes one person made in a time window, for the write rate limit. */
export interface RateLimitDoc {
  _id: string;
  n: number;
  expiresAt: Date;
}

export interface LoginAttemptDoc {
  _id?: ObjectId;
  phone: string;
  ip: string;
  at: Date;
}

export interface BookDoc extends Timestamps {
  _id: ObjectId;
  name: string;
  currency: string;
  color: string;
  ownerId: ObjectId;
  isPersonal: boolean;
  /** Order of the three default sections, from before custom sections; superseded by `sections`. */
  groupOrder?: HeadGroup[];
  /** The budget's sections, named and ordered by the family. Unset means the three defaults. */
  sections?: BudgetSection[];
  /** "Today" for the book; unset means Asia/Kolkata. */
  timeZone?: string;
  /** Budget month start day (salary day), 1–28; unset means 1. */
  monthStartDay?: number;
  /** en-IN (default), en-US or de-DE. */
  numberLocale?: string;
  /** Warn at this % of a spending budget; unset means 80. */
  alertAt?: number;
  deletedAt?: Date;
}

export interface BookMemberDoc {
  _id: ObjectId;
  bookId: ObjectId;
  userId: ObjectId;
  role: Role;
  invitedBy?: ObjectId;
  joinedAt: Date;
}

export interface InviteDoc {
  _id: ObjectId;
  bookId: ObjectId;
  role: AssignableRole;
  tokenHash: string;
  phone?: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  usedBy?: ObjectId;
  usedAt?: Date;
  revokedAt?: Date;
}

export interface ActivityDoc {
  _id?: ObjectId;
  bookId: ObjectId;
  userId: ObjectId;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'restore'
    | 'export'
    | 'role_change'
    | 'join'
    | 'leave'
    | 'remove'
    | 'transfer'
    | 'settings';
  entity: 'transaction' | 'category' | 'member' | 'book' | 'budget' | 'recurring';
  entityId: ObjectId;
  summary: string;
  diff?: Record<string, { from: unknown; to: unknown }>;
  at: Date;
}

/** Every document inside a book carries these. */
export interface BookScoped extends Timestamps {
  _id: ObjectId;
  bookId: ObjectId;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  version: number;
  deletedAt?: Date;
}

export interface CategoryDoc extends BookScoped {
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
  sort: number;
  archived: boolean;
  /** Expense categories: the id of the budget section it's in (older data: the kind, which is also a default section's id). Unset means "guess from the name". */
  group?: string;
  /** The category it sits inside (one level only). */
  parentId?: ObjectId;
  /** Carry unspent money to the next month, counting from budget month `rolloverFrom`. */
  rollover?: boolean;
  rolloverFrom?: string;
  /** A personal head (allowance) belonging to this member. */
  memberId?: ObjectId;
  /** Savings heads: a target to save up to. */
  goal?: { target: number; by: string | null; start: number };
}

export interface TransactionDoc extends BookScoped {
  type: 'income' | 'expense';
  amount: number;
  date: string;
  categoryId: ObjectId;
  note: string;
  /** Set on delete; a TTL index removes the document permanently at this time unless restored. */
  purgeAt?: Date;
  /** Client-supplied id; a unique index makes retried and offline-queued saves idempotent. */
  clientId?: string;
  /** The monthly entry this was added from. */
  recurringId?: ObjectId;
  /** Set on entries brought in from a spreadsheet, so a whole import can be undone. */
  importId?: string;
  tags?: string[];
  /** The member it was for. */
  forMember?: ObjectId;
  /** The account it was paid from or received into. */
  accountId?: ObjectId;
}

/** Where money is kept: cash, a bank account, a card, a wallet, a loan. */
export interface AccountDoc extends BookScoped {
  name: string;
  kind: 'cash' | 'bank' | 'card' | 'wallet' | 'loan' | 'other';
  /** Balance on openingDate, before that day's entries. Negative for money owed. */
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  sort: number;
}

/** Money moved between two accounts; neither income nor spending. */
export interface TransferDoc extends BookScoped {
  fromAccountId: ObjectId;
  toAccountId: ObjectId;
  amount: number;
  date: string;
  note: string;
}

/** An income or expense that repeats every month on the same day. */
export interface RecurringDoc extends BookScoped {
  type: 'income' | 'expense';
  amount: number;
  categoryId: ObjectId;
  note: string;
  dayOfMonth: number;
  startMonth: string; // YYYY-MM
  /** Every N months (unset: monthly). */
  everyMonths?: number;
  /** Last month it's due (unset: no end). */
  endMonth?: string;
  active: boolean;
  /** Months the user chose not to add it. */
  skippedMonths: string[];
}

/** One month's plan for a book: expected income split into budget heads (expense categories). */
export interface BudgetDoc {
  _id: ObjectId;
  bookId: ObjectId;
  month: string; // YYYY-MM
  income: number;
  lines: { categoryId: ObjectId; planned: number }[];
  /** Started automatically from this earlier month's plan; cleared once someone saves changes. */
  carriedFrom?: string;
  version: number;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface MetaDoc {
  _id: string;
  at: Date;
  /** On the 'indexes' doc: which INDEX_VERSION was last applied. */
  version?: number;
}

// ── connection (cached across warm serverless invocations) ──

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

async function client(): Promise<MongoClient> {
  clientPromise ??= MongoClient.connect(env().mongodbUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
  }).catch((err) => {
    clientPromise = undefined;
    throw err;
  });
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const db = (await client()).db(env().mongodbDb);
  indexesPromise ??= ensureIndexes(db).catch((err) => {
    indexesPromise = undefined;
    throw err;
  });
  await indexesPromise;
  return db;
}

export async function collections() {
  const db = await getDb();
  return {
    meta: db.collection<MetaDoc>('meta'),
    users: db.collection<UserDoc>('users'),
    sessions: db.collection<SessionDoc>('sessions'),
    loginAttempts: db.collection<LoginAttemptDoc>('loginAttempts'),
    books: db.collection<BookDoc>('books'),
    bookMembers: db.collection<BookMemberDoc>('bookMembers'),
    invites: db.collection<InviteDoc>('invites'),
    activity: db.collection<ActivityDoc>('activity'),
    categories: db.collection<CategoryDoc>('categories'),
    transactions: db.collection<TransactionDoc>('transactions'),
    budgets: db.collection<BudgetDoc>('budgets'),
    recurring: db.collection<RecurringDoc>('recurring'),
    passwordResets: db.collection<PasswordResetDoc>('passwordResets'),
    accounts: db.collection<AccountDoc>('accounts'),
    transfers: db.collection<TransferDoc>('transfers'),
    rateLimits: db.collection<RateLimitDoc>('rateLimits'),
    pushSubscriptions: db.collection<PushSubscriptionDoc>('pushSubscriptions'),
    pushLog: db.collection<PushLogDoc>('pushLog'),
  };
}

export type Collections = Awaited<ReturnType<typeof collections>>;

// Bump whenever the index list below changes, so the next cold start applies it.
const INDEX_VERSION = 6;

/**
 * Creating ~25 indexes costs several round trips, and every serverless cold start would pay it before
 * answering. Instead one read checks a marker, and the indexes are only (re)applied when it's out of date.
 */
async function ensureIndexes(db: Db) {
  const meta = db.collection<MetaDoc>('meta');
  const marker = await meta.findOne({ _id: 'indexes' }, { projection: { version: 1 } });
  if (marker?.version === INDEX_VERSION) return;
  await createIndexes(db);
  await meta.updateOne({ _id: 'indexes' }, { $set: { version: INDEX_VERSION, at: new Date() } }, { upsert: true });
}

async function createIndexes(db: Db) {
  const ops: Promise<unknown>[] = [
    db.collection('users').createIndex({ phone: 1 }, { unique: true }),
    db.collection('users').createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    ),
    db.collection('sessions').createIndex({ refreshTokenHash: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ userId: 1 }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('loginAttempts').createIndex({ phone: 1, at: -1 }),
    db.collection('loginAttempts').createIndex({ ip: 1, at: -1 }),
    db.collection('loginAttempts').createIndex({ at: 1 }, { expireAfterSeconds: 24 * 3600 }),
    db.collection('bookMembers').createIndex({ bookId: 1, userId: 1 }, { unique: true }),
    db.collection('bookMembers').createIndex({ userId: 1 }),
    db.collection('invites').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('invites').createIndex({ bookId: 1 }),
    // Keep expired invites for 30 days so "this invite expired" can still be shown.
    db.collection('invites').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }),
    db.collection('activity').createIndex({ bookId: 1, at: -1 }),
    db.collection('activity').createIndex({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 }),
    db.collection('categories').createIndex({ bookId: 1, kind: 1, sort: 1 }),
    db.collection('transactions').createIndex({ bookId: 1, date: -1 }),
    db.collection('transactions').createIndex({ bookId: 1, categoryId: 1, date: -1 }),
    db.collection('transactions').createIndex({ bookId: 1, createdBy: 1, date: -1 }),
    // "Recently deleted" list, and permanent removal once the restore window ends.
    db.collection('transactions').createIndex(
      { bookId: 1, deletedAt: -1 },
      { partialFilterExpression: { deletedAt: { $type: 'date' } } },
    ),
    db.collection('transactions').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('transactions').createIndex(
      { bookId: 1, clientId: 1 },
      { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
    ),
    db.collection('transactions').createIndex(
      { bookId: 1, recurringId: 1, date: 1 },
      { partialFilterExpression: { recurringId: { $type: 'objectId' } } },
    ),
    db.collection('transactions').createIndex(
      { bookId: 1, importId: 1 },
      { partialFilterExpression: { importId: { $type: 'string' } } },
    ),
    db.collection('transactions').createIndex({ bookId: 1, tags: 1 }, { partialFilterExpression: { tags: { $exists: true } } }),
    db.collection('passwordResets').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('passwordResets').createIndex({ userId: 1 }),
    db.collection('passwordResets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('transactions').createIndex({ bookId: 1, accountId: 1, date: -1 }, { partialFilterExpression: { accountId: { $exists: true } } }),
    db.collection('accounts').createIndex({ bookId: 1, sort: 1 }),
    db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('pushSubscriptions').createIndex({ endpoint: 1 }, { unique: true }),
    db.collection('pushSubscriptions').createIndex({ userId: 1 }),
    db.collection('pushLog').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('transfers').createIndex({ bookId: 1, date: -1 }),
    db.collection('recurring').createIndex({ bookId: 1 }),
    db.collection('budgets').createIndex({ bookId: 1, month: 1 }, { unique: true }),
  ];
  await Promise.all(ops);
}

/** For tests only. */
export async function closeDb() {
  if (clientPromise) await (await clientPromise).close();
  clientPromise = undefined;
  indexesPromise = undefined;
}
