import type { HeadGroup } from './categories.ts';
import type { AssignableRole, Permission, Role } from './rbac.ts';

// API response shapes shared by the API and the web app. Ids are hex strings.

export interface UserDTO {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isInstanceOwner: boolean;
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
  /** The order budget sections (bills, spending, savings) are listed in; chosen by whoever plans the budget. */
  groupOrder: HeadGroup[];
}

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
  /** Expense categories only: how it's tracked as a budget head. Guessed from the name until someone sets it. */
  group: HeadGroup;
  /** A personal head (an allowance): the member whose spending it is. */
  memberId: string | null;
  /** Savings heads: what it's being saved up for. */
  goal: CategoryGoal | null;
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
  /** Set when the entry came from a monthly recurring entry. */
  recurringId: string | null;
}

/** Searching across all months. */
export interface TransactionSearchDTO {
  items: TransactionDTO[];
  /** More matches exist than were returned; narrow the search. */
  truncated: boolean;
}

export interface RecurringDTO {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string;
  note: string;
  dayOfMonth: number;
  startMonth: string;
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
  group: HeadGroup;
  planned: number;
  spent: number;
  /** planned − spent; negative when over budget. */
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
  unbudgeted: { categoryId: string; group: HeadGroup; spent: number }[];
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
