import type { BudgetSection, HeadGroup } from './categories.ts';
import type { AssignableRole, Permission, Role } from './rbac.ts';

// API response shapes shared by the API and the web app. Ids are hex strings.

export interface UserDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isInstanceOwner: boolean;
  /** Unused recovery codes; when low, make new ones in Settings → Password. */
  recoveryCodesLeft: number;
  /** Which reminders this person gets as notifications. */
  notify: { bills: boolean; budget: boolean };
}

/** Whether the server can send notifications, and this person's devices that receive them. */
export interface PushStatusDTO {
  /** Base64url VAPID public key; null when the server isn't set up for notifications. */
  publicKey: string | null;
  endpoints: string[];
}

/** For the instance owner's Users screen. */
export interface AdminUserDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isInstanceOwner: boolean;
  disabled: boolean;
  createdAt: string;
  /** Most recent use of any signed-in device. */
  lastActiveAt: string | null;
  bookCount: number;
  recoveryCodesLeft: number;
}

/** A one-time link the instance owner gives someone who can't sign in. */
export interface ResetLinkDTO {
  token: string;
  expiresAt: string;
}

/** What a reset link shows before it's used. */
export interface ResetPreviewDTO {
  name: string;
  expiresAt: string;
}

/** Result of importing rows from a spreadsheet. */
export interface ImportResultDTO {
  added: number;
  /** Rows that matched an existing entry (same date, type, amount and note). */
  skipped: number;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  /** Present only right after setup/register: shown once, never retrievable again. */
  recoveryCodes?: string[];
}

export interface BookDTO {
  id: string;
  name: string;
  currency: string;
  color: string;
  isPersonal: boolean;
  ownerId: string;
  role: Role;
  permissions: Permission[];
  memberCount: number;
  /** The budget's sections, in the order they're listed; named and arranged by whoever plans the budget. */
  sections: BudgetSection[];
  /** The kinds (bills, spending, savings) in the order their first section appears. For older app versions. */
  groupOrder: HeadGroup[];
  /** IANA time zone deciding "today" for everyone in the book. */
  timeZone: string;
  /** Day of the month the budget month starts (1–28): salary day. */
  monthStartDay: number;
  /** How amounts are written: en-IN, en-US or de-DE. */
  numberLocale: string;
  /** Warn when a spending category has used this % of its budget. */
  alertAt: number;
}

/** A book its owner deleted, still restorable for BOOK_RESTORE_DAYS. */
export interface DeletedBookDTO {
  id: string;
  name: string;
  color: string;
  deletedAt: string;
  /** Last day it can be restored. */
  restoreUntil: string;
}

/** Deleted books can be restored by their owner for this long. */
export const BOOK_RESTORE_DAYS = 30;

export interface MemberDTO {
  userId: string;
  name: string;
  phone: string;
  role: Role;
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  role: AssignableRole;
  phone: string | null;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
}

export interface InviteCreatedDTO extends InviteDTO {
  /** Raw token, returned only once at creation. */
  token: string;
}

export interface InvitePreviewDTO {
  bookName: string;
  role: AssignableRole;
  invitedByName: string;
  phoneRestricted: boolean;
  expiresAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
  /** Hidden from pickers; kept so older transactions still show their category. */
  archived: boolean;
  /** Expense categories only: how it's tracked in the budget (its section's kind). Guessed from the name until someone sets it. */
  group: HeadGroup;
  /** Expense categories only: the budget section it's listed under. */
  section: string;
  /** A personal head (an allowance): the member whose spending it is. */
  memberId: string | null;
  /** Savings heads: what it's being saved up for. */
  goal: CategoryGoal | null;
  /** Spending categories: what's left (or overspent) carries into the next month's budget. */
  rollover: boolean;
  /** The category it sits inside (a sub-category), if any. Only one level deep. */
  parentId: string | null;
}

export interface CategoryGoal {
  target: number;
  /** Month to reach it by (YYYY-MM), if there's a deadline. */
  by: string | null;
  /** Already saved before it was tracked here. */
  start: number;
}

export interface TransactionDTO {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  categoryId: string;
  note: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Set when the entry came from a repeating entry. */
  recurringId: string | null;
  tags: string[];
  /** The member it was for, if someone said. */
  forMemberId: string | null;
  /** The account it was paid from or received into. */
  accountId: string | null;
}

/** Tags used in a book, most used first. */
export interface TagDTO {
  tag: string;
  count: number;
}

/** Searching across all months. */
export interface TransactionSearchDTO {
  items: TransactionDTO[];
  /** More matches exist than were returned: ask for the next page, or narrow the search. */
  truncated: boolean;
  /** Totals over every match, not just this page. */
  totals?: { count: number; income: number; expense: number };
}

export interface RecurringDTO {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string;
  note: string;
  dayOfMonth: number;
  startMonth: string;
  /** Comes round every this many months (12 = yearly). */
  everyMonths: number;
  /** Last month it's due, if it ends (an EMI's final instalment). */
  endMonth: string | null;
  /** The next budget month it's due in, from this month on; null once it has ended. */
  nextDueMonth: string | null;
  active: boolean;
  createdBy: string;
  createdByName: string;
  version: number;
}

/** Monthly entries not yet added for a month (and whose day has come). */
export interface RecurringDueDTO {
  month: string;
  items: { recurring: RecurringDTO; date: string }[];
}

/** Month-by-month totals, oldest first. */
export interface TrendsDTO {
  months: { month: string; income: number; expense: number }[];
  /** Expense per category, aligned with `months`; largest total first. */
  byCategory: { categoryId: string; totals: number[] }[];
}

export const ACCOUNT_KINDS = ['cash', 'bank', 'card', 'wallet', 'loan', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank account',
  card: 'Credit card',
  wallet: 'UPI / wallet',
  loan: 'Loan',
  other: 'Other',
};

/** Where money is kept. Cards and loans usually have a negative balance (what's owed). */
export interface AccountDTO {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance on `openingDate`, before any entry from that day on. Minor units; negative for money owed. */
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  /** Opening balance plus money in, minus money out, up to today. */
  balance: number;
  /** Entries and transfers counted in the balance. */
  entries: number;
}

/** Money moved between two of the book's accounts (cash withdrawn, a card bill paid). Not income or spending. */
export interface TransferDTO {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  note: string;
  createdBy: string;
  createdByName: string;
}

/** Who spent and received what over a range of months. */
export interface PeopleReportDTO {
  /** By who added the entries. */
  addedBy: { userId: string; name: string; income: number; expense: number; count: number }[];
  /** Expenses marked as for someone; userId null for the rest. */
  forWhom: { userId: string | null; name: string; expense: number }[];
}

/** Deleted transactions stay restorable for this long, then are removed permanently. */
export const DELETED_RETENTION_DAYS = 30;

export interface DeletedTransactionDTO extends TransactionDTO {
  deletedAt: string;
  deletedByName: string;
  /** When it will be removed permanently. */
  purgeAt: string;
}

export interface BudgetLineDTO {
  categoryId: string;
  /** How it's tracked: bills, spending or savings. */
  group: HeadGroup;
  /** The section it's listed under. */
  section: string;
  planned: number;
  /** Carried in from earlier months (spending categories with rollover on); negative after an overspend. */
  rolloverIn: number;
  spent: number;
  /** planned + rolloverIn − spent; negative when over budget. */
  remaining: number;
  /** Bills set up as monthly entries: when it falls due this month and whether it's been added. */
  due: { date: string; recurringIds: string[]; paid: boolean } | null;
  /** Savings heads with a goal: progress up to the end of this month. */
  goal: { target: number; by: string | null; saved: number; monthlyNeeded: number | null } | null;
}

/**
 * One month's plan and how it's going. All amounts are minor units.
 * Savings heads count as money saved, not spent. "Planned savings" is income minus what's planned for
 * bills and spending; "projected savings" is what's left if every bill and spending head ends exactly at
 * its limit (or where it already is, if over) and no more unbudgeted spending happens.
 */
export interface BudgetDTO {
  month: string;
  /** false when there's no plan for this month and none before it to carry over. */
  exists: boolean;
  /** true when this month has its own saved plan; false when it's following an earlier month's. */
  saved: boolean;
  /** The month this plan was carried over from, until someone changes it. */
  carriedFrom: string | null;
  version: number;
  income: number;
  lines: BudgetLineDTO[];
  /** Expenses this month in categories that have no budget head. */
  unbudgeted: { categoryId: string; group: HeadGroup; section: string; spent: number }[];
  totals: {
    allocated: number;
    /** Income not given to any head. */
    unallocated: number;
    plannedSavings: number;
    /** Expenses that aren't savings. */
    spent: number;
    /** Put into savings heads (or unbudgeted savings categories) this month. */
    saved: number;
    overspent: number;
    projectedSavings: number;
    /** Income transactions actually recorded this month, for comparison with the plan. */
    incomeReceived: number;
  };
  /** Only for the current month: where we are in it, and what can still be spent per day. */
  today: {
    day: number;
    daysInMonth: number;
    /** Including today. */
    daysLeft: number;
    /** What's left across spending heads (not bills or savings), ignoring heads already over. */
    spendingLeft: number;
    safePerDay: number;
  } | null;
}

/** For planning: what each expense category usually takes, from the months before. */
export interface BudgetSuggestionsDTO {
  /** The months averaged, oldest first. */
  months: string[];
  byCategory: { categoryId: string; average: number; last: number }[];
}

export interface SummaryDTO {
  month: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  byCategory: { categoryId: string; total: number }[];
  recent: TransactionDTO[];
}

export interface ActivityDTO {
  id: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  at: string;
}

export interface SessionDTO {
  id: string;
  deviceName: string;
  lastUsedAt: string;
  current: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
