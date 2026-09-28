export interface DefaultCategory {
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
}

/** Seeded into every new book. */
/** Seeded into every new book. `icon` is a key into the web app's icon set. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Groceries', kind: 'expense', icon: 'cart', color: '#15803d' },
  { name: 'Food & Dining', kind: 'expense', icon: 'utensils', color: '#c2410c' },
  { name: 'Rent', kind: 'expense', icon: 'home', color: '#6d28d9' },
  { name: 'Utilities', kind: 'expense', icon: 'zap', color: '#a16207' },
  { name: 'Fuel & Transport', kind: 'expense', icon: 'fuel', color: '#0e7490' },
  { name: 'Shopping', kind: 'expense', icon: 'bag', color: '#be185d' },
  { name: 'Medical', kind: 'expense', icon: 'pill', color: '#b91c1c' },
  { name: 'Education', kind: 'expense', icon: 'education', color: '#1d4ed8' },
  { name: 'EMI & Loans', kind: 'expense', icon: 'bank', color: '#475569' },
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
