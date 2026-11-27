import { currentPeriod, DEFAULT_CALENDAR, periodOf, periodRange, setMoneyLocale, shiftDate, todayIn, type BookCalendar } from '@ffos/shared';

// The current book's calendar and number style. BookProvider sets these when the book changes, so the
// helpers below ("today", "this month", amounts) match what the server works out for that book.
let calendar: BookCalendar = DEFAULT_CALENDAR;
let nearAt = 0.8;

export function applyBookPreferences(prefs: { timeZone: string; monthStartDay: number; numberLocale: string; alertAt: number }) {
  calendar = { timeZone: prefs.timeZone || DEFAULT_CALENDAR.timeZone, startDay: prefs.monthStartDay || 1 };
  setMoneyLocale(prefs.numberLocale);
  nearAt = (prefs.alertAt || 80) / 100;
}

/** Share of a spending budget at which it's flagged as nearly used (the book's "warn at"). */
export const nearThreshold = () => nearAt;

/** The budget month a date falls in (the calendar month unless the book starts months on salary day). */
export function periodOfDate(date: string): string {
  return periodOf(date, calendar.startDay);
}

/** First and last day of a budget month. */
export function monthBounds(month: string): { from: string; to: string } {
  return periodRange(month, calendar.startDay);
}

/** "25 Sep – 24 Oct" when the book's months start on salary day; null for calendar months. */
export function periodRangeLabel(month: string): string | null {
  if (calendar.startDay === 1) return null;
  const { from, to } = periodRange(month, calendar.startDay);
  const fmt = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

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

/** YYYY-MM-DD in the book's time zone, so "today" matches the server for every member. */
export function todayISO(): string {
  return todayIn(calendar.timeZone);
}

/** The current budget month. */
export function currentMonth(): string {
  return currentPeriod(calendar);
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
