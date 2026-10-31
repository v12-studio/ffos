import {
  Apple,
  Baby,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Carrot,
  Clapperboard,
  Coffee,
  CreditCard,
  Droplet,
  Drumstick,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Hospital,
  House,
  Landmark,
  Mail,
  Milk,
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
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryDTO } from '@ffos/shared';
import { nameHue } from './ui.tsx';

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
  milk: Milk,
  vegetable: Carrot,
  fruit: Apple,
  meat: Drumstick,
  card: CreditCard,
  hospital: Hospital,
  post: Mail,
  savings: HandCoins,
  wallet: Wallet,
  bike: Bike,
  bus: Bus,
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

// New categories default to this grey and the generic tag.
const DEFAULT_COLOR = '#64748b';

/** A category still on the generic tag says nothing, so it's shown by its first letter instead. */
function monogram(category?: Pick<CategoryDTO, 'icon' | 'name'>): string | null {
  return category && categoryIcon(category) === Tag ? (category.name.trim()[0]?.toUpperCase() ?? '?') : null;
}

/** The category's colour, or one derived from its name when it still has the default grey and tag. */
function tileColor(category?: CategoryDTO): string {
  if (!category) return DEFAULT_COLOR;
  return monogram(category) && category.color === DEFAULT_COLOR ? `hsl(${nameHue(category.name)} 45% 38%)` : category.color;
}

/** Square tile with the category's icon on a light tint of its colour. */
export function CategoryTile({ category, size = 'md' }: { category?: CategoryDTO; size?: 'sm' | 'md' }) {
  const Icon = categoryIcon(category);
  const color = tileColor(category);
  const letter = monogram(category);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg ${size === 'sm' ? 'size-7 text-label' : 'size-9 text-body'} font-semibold`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
        // Blend toward the text colour so dark hues stay legible in dark mode.
        color: `color-mix(in srgb, ${color} 78%, var(--app-ink))`,
      }}
      aria-hidden
    >
      {letter ?? <Icon className={size === 'sm' ? 'size-4' : 'size-5'} strokeWidth={1.75} />}
    </span>
  );
}

/** Bare icon or letter for inside a chip. On a selected chip it takes the chip's text colour. */
export function CategoryGlyph({ category, selected }: { category: CategoryDTO; selected?: boolean }) {
  const Icon = categoryIcon(category);
  const letter = monogram(category);
  const color = selected ? undefined : `color-mix(in srgb, ${tileColor(category)} 78%, var(--app-ink))`;
  return letter ? (
    <span className="grid size-4 shrink-0 place-items-center text-label font-semibold" style={{ color }} aria-hidden>
      {letter}
    </span>
  ) : (
    <Icon className="size-4 shrink-0" strokeWidth={1.75} style={{ color }} aria-hidden />
  );
}
