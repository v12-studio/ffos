export interface DefaultCategory {
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
  group?: HeadGroup;
}

/**
 * What kind of budget head an expense category is. Each is tracked differently:
 * bills are paid once (paid / due), spending is drawn down through the month (pace),
 * savings are money put aside, so they count as saved rather than spent.
 */
export const HEAD_GROUPS = ['bills', 'spending', 'savings'] as const;
export type HeadGroup = (typeof HEAD_GROUPS)[number];

export const HEAD_GROUP_LABELS: Record<HeadGroup, { name: string; description: string }> = {
  bills: { name: 'Bills', description: 'Paid once a month: rent, EMIs, electricity, fees' },
  spending: { name: 'Spending', description: 'Day-to-day: milk, vegetables, fuel, eating out' },
  savings: { name: 'Savings', description: 'Put aside: chit, SIP, post office, goals. Counted as saved, not spent' },
};

const BILL_WORDS =
  /\b(rent|emi|emis|loan|loans|bill|bills|electricity|eb|water|gas|cylinder|internet|wifi|broadband|recharge|insurance|premium|lic|fees?|tuition|school|subscriptions?|netflix|maintenance|credit card)\b/i;
const SAVINGS_WORDS = /\b(seetu|chit|chits|sip|sips|savings?|post office|rd|fd|ppf|nps|mutual funds?|investments?|gold scheme|emergency fund)\b/i;

/**
 * The order the Budget tab lists its sections in. Each book can choose its own; this is the default.
 * Anything missing or unknown in a saved order is repaired, so the result always has every group once.
 */
export function normalizeGroupOrder(order?: readonly string[] | null): HeadGroup[] {
  const known = (order ?? []).filter((g, i, all): g is HeadGroup => (HEAD_GROUPS as readonly string[]).includes(g) && all.indexOf(g) === i);
  return [...known, ...HEAD_GROUPS.filter((g) => !known.includes(g))];
}

/** A best guess from the name, used until someone picks a group for the category. */
export function guessHeadGroup(name: string): HeadGroup {
  if (SAVINGS_WORDS.test(name)) return 'savings';
  if (BILL_WORDS.test(name)) return 'bills';
  return 'spending';
}

/** Seeded into every new book. `icon` is a key into the web app's icon set. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Groceries', kind: 'expense', icon: 'cart', color: '#15803d' },
  { name: 'Food & Dining', kind: 'expense', icon: 'utensils', color: '#c2410c' },
  { name: 'Rent', kind: 'expense', icon: 'home', color: '#6d28d9', group: 'bills' },
  { name: 'Utilities', kind: 'expense', icon: 'zap', color: '#a16207', group: 'bills' },
  { name: 'Fuel & Transport', kind: 'expense', icon: 'fuel', color: '#0e7490' },
  { name: 'Shopping', kind: 'expense', icon: 'bag', color: '#be185d' },
  { name: 'Medical', kind: 'expense', icon: 'pill', color: '#b91c1c' },
  { name: 'Education', kind: 'expense', icon: 'education', color: '#1d4ed8', group: 'bills' },
  { name: 'EMI & Loans', kind: 'expense', icon: 'bank', color: '#475569', group: 'bills' },
  { name: 'Entertainment', kind: 'expense', icon: 'film', color: '#7e22ce' },
  { name: 'Other', kind: 'expense', icon: 'package', color: '#64748b' },
  { name: 'Salary', kind: 'income', icon: 'briefcase', color: '#047857' },
  { name: 'Business', kind: 'income', icon: 'trending-up', color: '#0f766e' },
  { name: 'Interest', kind: 'income', icon: 'piggy-bank', color: '#4d7c0f' },
  { name: 'Other Income', kind: 'income', icon: 'plus', color: '#64748b' },
];

export const BOOK_COLORS = ['#1d4ed8', '#047857', '#b45309', '#7c3aed', '#0e7490', '#be123c', '#475569'];

const CATCH_ALL_NAMES = new Set(['Other', 'Other Income']);

/** The seeded "Other" categories: listed last, and picking one offers to add a named category. */
export function isCatchAllCategory(category: { name: string }): boolean {
  return CATCH_ALL_NAMES.has(category.name);
}
