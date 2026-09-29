import { currentAppMonth, shiftDate, todayInAppZone } from '@ffos/shared';

/** "₹" for INR, "$" for USD… falls back to the code. */
export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en-IN', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ??
      currency
    );
  } catch {
    return currency;
  }
}

/** Minor units → plain editable text ("12000", "450.5"). */
export function minorToInput(minor: number): string {
  return minor ? String(minor / 100) : '';
}

/** YYYY-MM-DD in Mumbai time, so "today" matches the server for every member. */
export function todayISO(): string {
  return todayInAppZone();
}

export function currentMonth(): string {
  return currentAppMonth();
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dayLabel(date: string): string {
  const today = todayISO();
  if (date === today) return 'Today';
  if (date === shiftDate(today, -1)) return 'Yesterday';
  const [yy, mm, dd] = date.split('-').map(Number) as [number, number, number];
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
