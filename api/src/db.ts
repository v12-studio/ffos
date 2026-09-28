import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import type { AssignableRole, Role } from '@ffos/shared';
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
  entity: 'transaction' | 'category' | 'member' | 'book' | 'budget';
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
}

export interface TransactionDoc extends BookScoped {
  type: 'income' | 'expense';
  amount: number;
  date: string;
  categoryId: ObjectId;
  note: string;
  /** Set on delete; a TTL index removes the document permanently at this time unless restored. */
  purgeAt?: Date;
}

/** One month's plan for a book: expected income split into budget heads (expense categories). */
export interface BudgetDoc {
  _id: ObjectId;
  bookId: ObjectId;
  month: string; // YYYY-MM
  income: number;
  lines: { categoryId: ObjectId; planned: number }[];
  version: number;
  createdBy: ObjectId;
  updatedBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface MetaDoc {
  _id: string;
  at: Date;
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
  };
}

export type Collections = Awaited<ReturnType<typeof collections>>;

async function ensureIndexes(db: Db) {
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
