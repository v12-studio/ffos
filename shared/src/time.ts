/** Dates in the app ("today", "this month") follow Mumbai time for every user and server. */
export const APP_TIME_ZONE = 'Asia/Kolkata';

/** YYYY-MM-DD in Mumbai time. */
export function todayInAppZone(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}

/** YYYY-MM in Mumbai time. */
export function currentAppMonth(now: Date = new Date()): string {
  return todayInAppZone(now).slice(0, 7);
}

/** Adds `days` to a YYYY-MM-DD date. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Adds `delta` months to a YYYY-MM month. */
export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The date a monthly entry falls on: day 31 becomes the 30th in April, the 28th/29th in February. */
export function recurringDate(month: string, dayOfMonth: number): string {
  const day = Math.min(dayOfMonth, daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}
