import {
  BookOpen,
  Briefcase,
  Clapperboard,
  Fuel,
  GraduationCap,
  House,
  Landmark,
  Package,
  PiggyBank,
  Pill,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Tag,
  TrendingUp,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryDTO } from '@ffos/shared';

const ICONS: Record<string, LucideIcon> = {
  cart: ShoppingCart,
  utensils: Utensils,
  home: House,
  zap: Zap,
  fuel: Fuel,
  bag: ShoppingBag,
  pill: Pill,
  education: GraduationCap,
  bank: Landmark,
  film: Clapperboard,
  package: Package,
  briefcase: Briefcase,
  'trending-up': TrendingUp,
  'piggy-bank': PiggyBank,
  plus: Plus,
  book: BookOpen,
  tag: Tag,
};

// Books created before icons were keys stored emoji; match those by the default category name.
const BY_NAME: Record<string, LucideIcon> = {
  Groceries: ShoppingCart,
  'Food & Dining': Utensils,
  Rent: House,
  Utilities: Zap,
  'Fuel & Transport': Fuel,
  Shopping: ShoppingBag,
  Medical: Pill,
  Education: GraduationCap,
  'EMI & Loans': Landmark,
  Entertainment: Clapperboard,
  Other: Package,
  Salary: Briefcase,
  Business: TrendingUp,
  Interest: PiggyBank,
  'Other Income': Plus,
};

export function categoryIcon(category?: Pick<CategoryDTO, 'icon' | 'name'>): LucideIcon {
  if (!category) return Tag;
  return ICONS[category.icon] ?? BY_NAME[category.name] ?? Tag;
}

/** Square tile with the category's icon on a light tint of its colour. */
export function CategoryTile({ category, size = 'md' }: { category?: CategoryDTO; size?: 'sm' | 'md' }) {
  const Icon = categoryIcon(category);
  const color = category?.color ?? '#64748b';
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg ${size === 'sm' ? 'size-7' : 'size-10'}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
        // Blend toward the text colour so dark hues stay legible in dark mode.
        color: `color-mix(in srgb, ${color} 78%, var(--app-ink))`,
      }}
      aria-hidden
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} strokeWidth={1.75} />
    </span>
  );
}
