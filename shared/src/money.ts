/** Convert a user-entered decimal string ("1,234.50") to integer minor units (123450). */
export function toMinor(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

/** How amounts are grouped and punctuated: en-IN 1,00,000.00 · en-US 100,000.00 · de-DE 100.000,00. */
export const NUMBER_LOCALES = ['en-IN', 'en-US', 'de-DE'] as const;
export type NumberLocale = (typeof NUMBER_LOCALES)[number];

let defaultLocale: string = 'en-IN';

/** The web app sets this to the current book's number style; the server keeps en-IN. */
export function setMoneyLocale(locale: string) {
  defaultLocale = (NUMBER_LOCALES as readonly string[]).includes(locale) ? locale : 'en-IN';
}

export function formatMoney(minor: number, currency = 'INR', locale = defaultLocale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}
