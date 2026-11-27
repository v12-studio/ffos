import { Check } from 'lucide-react';
import { useId, useMemo } from 'react';
import { BOOK_COLORS } from '@ffos/shared';
import { inputClass } from './ui.tsx';

// Inputs shared by "New book" and Book settings.

/** Currencies most families using the app deal in, listed first. */
const COMMON_CURRENCIES = ['INR', 'USD', 'AED', 'GBP', 'EUR', 'SGD', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'MYR', 'AUD', 'CAD', 'NZD', 'LKR', 'NPR', 'BDT', 'PKR', 'JPY', 'CHF', 'ZAR'];

function currencyOptions(current: string): { code: string; label: string }[] {
  const names = (() => {
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' });
    } catch {
      return null;
    }
  })();
  const symbol = (code: string) => {
    try {
      const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value;
      return part && part !== code ? `${part} ` : '';
    } catch {
      return '';
    }
  };
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : COMMON_CURRENCIES;
  const rest = all.filter((c) => !COMMON_CURRENCIES.includes(c)).sort();
  const codes = [...new Set([...COMMON_CURRENCIES, ...(all.includes(current) || !current ? [] : [current]), ...rest])];
  return codes.map((code) => ({ code, label: `${symbol(code)}${code} · ${names?.of(code) ?? code}` }));
}

/** A list of currencies by name and symbol, so nobody has to know ISO codes. */
export function CurrencySelect({ value, onChange, error }: { value: string; onChange: (code: string) => void; error?: string }) {
  const id = useId();
  const options = useMemo(() => currencyOptions(value), [value]);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-label font-medium">
        Currency
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} className={inputClass}>
        <optgroup label="Common">
          {options.slice(0, COMMON_CURRENCIES.length).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="All currencies">
          {options.slice(COMMON_CURRENCIES.length).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>
      {error && <p className="mt-1.5 text-label text-negative">{error}</p>}
    </div>
  );
}

/** The book's colour: shown beside its name everywhere, so books are easy to tell apart. */
export function ColourPicker({ value, onChange, label = 'Colour' }: { value: string; onChange: (colour: string) => void; label?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-label font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {BOOK_COLORS.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={on}
              className={`grid size-10 place-items-center rounded-full ring-offset-2 ring-offset-surface ${on ? 'ring-2 ring-ink' : ''}`}
              style={{ backgroundColor: c }}
            >
              {on && <Check className="size-4 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Colombo', 'Asia/Kathmandu', 'Asia/Dhaka', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'Australia/Sydney'];

/** The book's time zone: decides when "today" and "this month" change for everyone in it. */
export function TimeZoneSelect({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const id = useId();
  const options = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_ZONES;
    const rest = all.filter((z) => !COMMON_ZONES.includes(z));
    return { common: [...COMMON_ZONES, ...(all.includes(value) || COMMON_ZONES.includes(value) ? [] : [value])], rest };
  }, [value]);
  const label = (zone: string) => {
    try {
      const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
      return `${zone.replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`;
    } catch {
      return zone;
    }
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-label font-medium">
        Time zone
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <optgroup label="Common">
          {options.common.map((z) => (
            <option key={z} value={z}>
              {label(z)}
            </option>
          ))}
        </optgroup>
        <optgroup label="All time zones">
          {options.rest.map((z) => (
            <option key={z} value={z}>
              {label(z)}
            </option>
          ))}
        </optgroup>
      </select>
      <p className="mt-1.5 text-caption text-muted">When "today" and "this month" change, for everyone in this book.</p>
    </div>
  );
}
