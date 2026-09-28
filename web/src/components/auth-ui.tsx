import { useId, useState, type ReactNode } from 'react';
import { inputClass } from './ui.tsx';

export function Logo({ className = 'size-8' }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className={className} />;
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-safe sm:justify-center sm:py-10">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2.5 py-6 sm:justify-center sm:pb-8">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Family Finance OS</span>
        </div>
        <div className="sm:rounded-xl sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-[0_1px_3px_rgb(16_24_40/0.06)]">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Country code + number, emitted as a single E.164-ish string ("+919876543210"). */
export function PhoneField({
  value,
  onChange,
  error,
  label = 'Phone number',
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
}) {
  const id = useId();
  // Code and number are kept separately: re-splitting "+919…" can't tell where the code ends.
  const [code, setCode] = useState('+91');
  const [number, setNumber] = useState(() => (value.startsWith('+91') ? value.slice(3) : ''));
  // The parent reset the value (e.g. a form cleared back to "+91"): follow it.
  if (value !== `${code}${number}` && value.startsWith(code)) setNumber(value.slice(code.length));

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          aria-label="Country code"
          value={code}
          inputMode="tel"
          onChange={(e) => {
            const c = `+${e.target.value.replace(/\D/g, '').slice(0, 3)}`;
            setCode(c);
            onChange(`${c}${number}`);
          }}
          className={`${inputClass} w-18! text-center`}
        />
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={number}
          onChange={(e) => {
            const n = e.target.value.replace(/\D/g, '').slice(0, 14);
            setNumber(n);
            onChange(`${code}${n}`);
          }}
          aria-invalid={Boolean(error)}
          className={`${inputClass} min-w-0 flex-1`}
        />
      </div>
      {error && <p className="mt-1.5 text-sm text-negative">{error}</p>}
    </div>
  );
}
