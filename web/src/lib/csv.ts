// Reading bank statements and other spreadsheets saved as CSV.

/** Splits CSV text into rows of cells. Handles quotes, "" inside quotes, CRLF, a BOM, and , ; or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop blank lines.
  return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => c.trim()));
}

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export const DATE_ORDER_LABEL: Record<DateOrder, string> = {
  dmy: 'Day first (31/12/2026)',
  mdy: 'Month first (12/31/2026)',
  ymd: 'Year first (2026-12-31)',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "03/10/2026", "3-Oct-26", "2026-10-03", "03 Oct 2026 10:15" → "2026-10-03", or null. */
export function parseDate(value: string, order: DateOrder): string | null {
  // Ignore a time after the date.
  const parts = value
    .trim()
    .replace(/[T\s]\d{1,2}:\d{2}.*$/, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length !== 3) return null;
  let d: number, m: number, y: number;
  const monthName = parts.findIndex((p) => /^[A-Za-z]{3,}$/.test(p));
  if (monthName >= 0) {
    m = MONTHS.indexOf(parts[monthName]!.slice(0, 3).toLowerCase()) + 1;
    const nums = parts.filter((_, i) => i !== monthName).map(Number);
    // "Oct 03 2026" / "03 Oct 2026" / "2026 Oct 03"
    if (nums[0]! > 31) [y, d] = [nums[0]!, nums[1]!];
    else [d, y] = [nums[0]!, nums[1]!];
  } else {
    const n = parts.map(Number);
    if (n.some((x) => Number.isNaN(x))) return null;
    if (order === 'ymd' || parts[0]!.length === 4) [y, m, d] = [n[0]!, n[1]!, n[2]!];
    else if (order === 'mdy') [m, d, y] = [n[0]!, n[1]!, n[2]!];
    else [d, m, y] = [n[0]!, n[1]!, n[2]!];
  }
  if (y < 100) y += 2000;
  if (!m || m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** The order that reads every sample as a date, preferring day-first (as Indian banks write them). */
export function guessDateOrder(samples: string[]): DateOrder {
  const order = (['dmy', 'ymd', 'mdy'] as const).find((o) => samples.every((s) => !s || parseDate(s, o) !== null));
  return order ?? 'dmy';
}

/**
 * "1,234.50", "₹ 1,234.50", "(500.00)", "500.00-", "500.00 Dr", "-₹45" → minor units, signed.
 * Dr (debit) is money out (negative); Cr (credit) is money in. Empty or unreadable → null.
 */
export function parseAmount(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let sign = 1;
  if (/\bdr\.?$/i.test(text)) {
    sign = -1;
    text = text.replace(/\bdr\.?$/i, '');
  } else if (/\bcr\.?$/i.test(text)) text = text.replace(/\bcr\.?$/i, '');
  if (/^\(.*\)$/.test(text)) {
    sign = -sign;
    text = text.slice(1, -1);
  }
  if (/-$/.test(text.trim())) {
    sign = -sign;
    text = text.trim().slice(0, -1);
  }
  if (/^\s*-/.test(text.replace(/[^\d.,-]/g, ''))) sign = -sign;
  const digits = text.replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return sign * Math.round(Number(digits) * 100);
}

/** Whether a Dr/Cr or Debit/Credit cell means money out. null when it says neither. */
export function isDebit(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (/^(dr|debit|d|withdrawal|paid|out|expense)\b/.test(v)) return true;
  if (/^(cr|credit|c|deposit|received|in|income)\b/.test(v)) return false;
  return null;
}
