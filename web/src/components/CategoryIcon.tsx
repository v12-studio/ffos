import {
  Baby,
  BookOpen,
  Briefcase,
  Car,
  Clapperboard,
  Coffee,
  Droplet,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Package,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Plus,
  Receipt,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  Tv,
  Utensils,
  Wifi,
  Wrench,
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
  car: Car,
  phone: Smartphone,
  wifi: Wifi,
  tv: Tv,
  water: Droplet,
  repair: Wrench,
  health: HeartPulse,
  fitness: Dumbbell,
  kids: Baby,
  pets: PawPrint,
  travel: Plane,
  clothes: Shirt,
  coffee: Coffee,
  gift: Gift,
  bill: Receipt,
  care: Sparkles,
};

/** Icon keys offered when editing a category, in picker order. */
export const ICON_KEYS = Object.keys(ICONS);

/** Colours offered when editing a category (readable on light and dark surfaces). */
export const CATEGORY_COLORS = [
  '#15803d', '#047857', '#0e7490', '#1d4ed8', '#4338ca', '#6d28d9', '#7e22ce',
  '#be185d', '#b91c1c', '#c2410c', '#a16207', '#4d7c0f', '#475569', '#64748b',
];

export function iconFor(key: string): LucideIcon {
  return ICONS[key] ?? Tag;
}

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
