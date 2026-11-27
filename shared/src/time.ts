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

/** How a book counts days: its time zone, and the day of the month its budget month starts (salary day). */
export interface BookCalendar {
  timeZone: string;
  /** 1–28. 1 is the calendar month; 5 makes "November" run 5 Nov – 4 Dec (named after the month it starts in). */
  startDay: number;
}

export const DEFAULT_CALENDAR: BookCalendar = { timeZone: APP_TIME_ZONE, startDay: 1 };

const clampStart = (startDay: number) => Math.min(28, Math.max(1, Math.trunc(startDay) || 1));
const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the given time zone (falls back to Mumbai time for an unknown zone). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return now.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return todayInAppZone(now);
  }
}

/**
 * The days of budget month `month` (inclusive). With a start day of 1 it's the calendar month; otherwise it
 * runs from the start day in that month up to the day before the start day in the next: November with 5 →
 * 5 Nov – 4 Dec. A budget month is named after the month it starts in, like a salary.
 */
export function periodRange(month: string, startDay = 1): { from: string; to: string } {
  const start = clampStart(startDay);
  if (start === 1) return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
  return { from: `${month}-${pad(start)}`, to: `${shiftMonthKey(month, 1)}-${pad(start - 1)}` };
}

/** The budget month a date falls in: days before the start day belong to the month before. */
export function periodOf(date: string, startDay = 1): string {
  const start = clampStart(startDay);
  const month = date.slice(0, 7);
  return start > 1 && Number(date.slice(8, 10)) < start ? shiftMonthKey(month, -1) : month;
}

/** The current budget month in the book's time zone. */
export function currentPeriod(calendar: BookCalendar, now: Date = new Date()): string {
  return periodOf(todayIn(calendar.timeZone, now), calendar.startDay);
}

/** How many days budget month `month` has. */
export function periodLength(month: string, startDay = 1): number {
  const { from, to } = periodRange(month, startDay);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Which day of its budget month `date` is (1 = the first day). */
export function dayOfPeriod(date: string, startDay = 1): number {
  const { from } = periodRange(periodOf(date, startDay), startDay);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The date a monthly entry on `dayOfMonth` falls on within budget month `month`. */
export function occurrenceIn(month: string, dayOfMonth: number, startDay = 1): string {
  const start = clampStart(startDay);
  // Days before the start day come in the second calendar month of the budget month.
  if (start > 1 && dayOfMonth < start) return recurringDate(shiftMonthKey(month, 1), dayOfMonth);
  return recurringDate(month, dayOfMonth);
}

/** Mongo expression for a transaction's budget month, from its `date` field. */
export function periodExpression(startDay = 1): unknown {
  const start = clampStart(startDay);
  const month = { $substrBytes: ['$date', 0, 7] };
  if (start === 1) return month;
  // Dates before the start day belong to the month before: build "YYYY-MM" for month − 1.
  const y = { $toInt: { $substrBytes: ['$date', 0, 4] } };
  const m = { $toInt: { $substrBytes: ['$date', 5, 2] } };
  const prevY = { $cond: [{ $eq: [m, 1] }, { $subtract: [y, 1] }, y] };
  const prevM = { $cond: [{ $eq: [m, 1] }, 12, { $subtract: [m, 1] }] };
  const prev = {
    $concat: [{ $toString: prevY }, '-', { $cond: [{ $lt: [prevM, 10] }, { $concat: ['0', { $toString: prevM }] }, { $toString: prevM }] }],
  };
  return { $cond: [{ $lt: [{ $substrBytes: ['$date', 8, 2] }, pad(start)] }, prev, month] };
}

/** Months between two YYYY-MM keys (to − from). */
export function monthsBetweenKeys(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** Whether a repeating entry falls due in `month`: from its start, every N months, up to its last month. */
export function isDueIn(rule: { startMonth: string; everyMonths?: number; endMonth?: string | null }, month: string): boolean {
  if (month < rule.startMonth || (rule.endMonth && month > rule.endMonth)) return false;
  return monthsBetweenKeys(rule.startMonth, month) % (rule.everyMonths ?? 1) === 0;
}

/** The first month from `from` on that the entry is due, or null if it has ended. */
export function nextDueMonth(rule: { startMonth: string; everyMonths?: number; endMonth?: string | null }, from: string): string | null {
  const every = rule.everyMonths ?? 1;
  let month = from < rule.startMonth ? rule.startMonth : from;
  const offset = monthsBetweenKeys(rule.startMonth, month) % every;
  if (offset) month = shiftMonthKey(month, every - offset);
  return rule.endMonth && month > rule.endMonth ? null : month;
}
