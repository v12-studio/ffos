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

/**
 * A section of the budget as the family names it ("EMIs & loans", "Kids"). Each behaves like one of the
 * three kinds (`kind`), which decides how it's tracked: bills paid once, spending drawn down, savings put aside.
 * The default sections use the kind as their id, so older data (which stored the kind) still lines up.
 */
export interface BudgetSection {
  id: string;
  name: string;
  kind: HeadGroup;
}

export const MAX_SECTIONS = 8;
export const SECTION_ID = /^[a-z0-9-]{1,24}$/;

/**
 * The book's sections in order, repaired so each kind has at least one section and ids are unique.
 * Books from before sections existed get the three defaults, in their saved group order.
 */
export function normalizeSections(sections?: readonly BudgetSection[] | null, groupOrder?: readonly string[] | null): BudgetSection[] {
  const out: BudgetSection[] = [];
  for (const s of sections ?? []) {
    if (!s || !SECTION_ID.test(s.id) || !(HEAD_GROUPS as readonly string[]).includes(s.kind) || !s.name?.trim()) continue;
    if (out.some((o) => o.id === s.id)) continue;
    out.push({ id: s.id, name: s.name.trim().slice(0, 24), kind: s.kind });
  }
  if (!out.length) return normalizeGroupOrder(groupOrder).map((g) => ({ id: g, name: HEAD_GROUP_LABELS[g].name, kind: g }));
  for (const kind of HEAD_GROUPS) {
    if (out.some((s) => s.kind === kind)) continue;
    const id = out.some((s) => s.id === kind) ? `${kind}-${out.length}` : kind;
    out.push({ id, name: HEAD_GROUP_LABELS[kind].name, kind });
  }
  return out.slice(0, MAX_SECTIONS + HEAD_GROUPS.length);
}

/**
 * The section a category sits in: the one it was put in if that still exists, otherwise the first section
 * of its kind (what it was set to before sections existed, or a guess from its name).
 */
export function sectionFor(category: { name: string; group?: string | null }, sections: readonly BudgetSection[]): BudgetSection {
  const own = category.group ? sections.find((s) => s.id === category.group) : undefined;
  if (own) return own;
  const kind = (HEAD_GROUPS as readonly string[]).includes(category.group ?? '') ? (category.group as HeadGroup) : guessHeadGroup(category.name);
  return sections.find((s) => s.kind === kind) ?? sections[0]!;
}

/** The kinds in the order their first section appears. */
export function kindOrder(sections: readonly BudgetSection[]): HeadGroup[] {
  return normalizeGroupOrder(sections.map((s) => s.kind));
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

/** What a new book starts with. Every template keeps the "Other" fallbacks. */
export const BOOK_TEMPLATES = ['household', 'trip', 'business', 'blank'] as const;
export type BookTemplate = (typeof BOOK_TEMPLATES)[number];

export const BOOK_TEMPLATE_LABELS: Record<BookTemplate, { name: string; description: string }> = {
  household: { name: 'Household', description: 'Groceries, rent, bills, fuel, school fees…' },
  trip: { name: 'Trip or event', description: 'Travel, stay, food, tickets, shopping' },
  business: { name: 'Small business', description: 'Sales, purchases, rent, wages, taxes' },
  blank: { name: 'Start empty', description: 'Just "Other"; add your own categories' },
};

const CATCH_ALLS: DefaultCategory[] = [
  { name: 'Other', kind: 'expense', icon: 'package', color: '#64748b' },
  { name: 'Other Income', kind: 'income', icon: 'plus', color: '#64748b' },
];

export const TEMPLATE_CATEGORIES: Record<BookTemplate, DefaultCategory[]> = {
  household: [] as DefaultCategory[], // filled below from DEFAULT_CATEGORIES
  trip: [
    { name: 'Travel', kind: 'expense', icon: 'travel', color: '#0e7490' },
    { name: 'Stay', kind: 'expense', icon: 'home', color: '#6d28d9' },
    { name: 'Food', kind: 'expense', icon: 'utensils', color: '#c2410c' },
    { name: 'Local transport', kind: 'expense', icon: 'bus', color: '#0f766e' },
    { name: 'Tickets & activities', kind: 'expense', icon: 'film', color: '#7e22ce' },
    { name: 'Shopping', kind: 'expense', icon: 'bag', color: '#be185d' },
    { name: 'Contributions', kind: 'income', icon: 'briefcase', color: '#047857' },
    ...CATCH_ALLS,
  ],
  business: [
    { name: 'Purchases & stock', kind: 'expense', icon: 'cart', color: '#15803d' },
    { name: 'Rent', kind: 'expense', icon: 'home', color: '#6d28d9', group: 'bills' },
    { name: 'Wages', kind: 'expense', icon: 'briefcase', color: '#1d4ed8', group: 'bills' },
    { name: 'Utilities', kind: 'expense', icon: 'zap', color: '#a16207', group: 'bills' },
    { name: 'Transport', kind: 'expense', icon: 'fuel', color: '#0e7490' },
    { name: 'Marketing', kind: 'expense', icon: 'trending-up', color: '#be185d' },
    { name: 'Fees & taxes', kind: 'expense', icon: 'bank', color: '#475569', group: 'bills' },
    { name: 'Sales', kind: 'income', icon: 'trending-up', color: '#047857' },
    ...CATCH_ALLS,
  ],
  blank: CATCH_ALLS,
};

export const BOOK_COLORS = ['#1d4ed8', '#047857', '#b45309', '#7c3aed', '#0e7490', '#be123c', '#475569'];

const CATCH_ALL_NAMES = new Set(['Other', 'Other Income']);

/** The seeded "Other" categories: listed last, and picking one offers to add a named category. */
export function isCatchAllCategory(category: { name: string }): boolean {
  return CATCH_ALL_NAMES.has(category.name);
}

TEMPLATE_CATEGORIES.household = DEFAULT_CATEGORIES;
