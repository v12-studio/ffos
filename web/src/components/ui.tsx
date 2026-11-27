import { ChevronRight, Eye, EyeOff, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ROLE_LABELS, type Role } from '@ffos/shared';
import { ApiError } from '../lib/api.ts';
import { initials } from '../lib/format.ts';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90 active:bg-primary/80 disabled:bg-subtle disabled:text-muted',
  secondary: 'border border-line bg-surface text-ink hover:bg-subtle active:bg-subtle disabled:opacity-50',
  danger: 'border border-line bg-surface text-negative hover:bg-negative/5 active:bg-negative/10 disabled:opacity-50',
  ghost: 'text-accent hover:bg-subtle active:bg-subtle disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-body font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export const inputClass =
  'block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/15 aria-invalid:border-negative disabled:bg-subtle disabled:text-muted';

export function Field({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  // Password fields get a show/hide button: easier than retyping on a phone keyboard.
  const [shown, setShown] = useState(false);
  const isPassword = props.type === 'password';
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-label font-medium">
        {label}
      </label>
      {isPassword ? (
        <div className="relative">
          <input id={id} {...props} type={shown ? 'text' : 'password'} aria-invalid={Boolean(error)} className={`${inputClass} pr-11`} />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink"
          >
            {shown ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
          </button>
        </div>
      ) : (
        <input id={id} {...props} aria-invalid={Boolean(error)} className={inputClass} />
      )}
      {error ? (
        <p className="mt-1.5 text-label text-negative">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-label text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullScreenSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center text-muted">
      <Spinner className="size-6" />
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div role="alert" className="rounded-lg border border-negative/25 bg-negative/5 px-3.5 py-2.5 text-label text-negative">
      {message}
    </div>
  );
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04)] ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-6 items-center justify-between px-0.5">
      <h2 className="text-label font-semibold text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-line bg-subtle px-2 py-0.5 text-caption font-medium text-muted">
      {ROLE_LABELS[role].name}
    </span>
  );
}

/** A stable hue for a name, so the same person or category always gets the same colour. */
export function nameHue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function Avatar({ name, className = 'size-9' }: { name: string; className?: string }) {
  const hue = nameHue(name);
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full text-label font-semibold ${className}`}
      style={{
        backgroundColor: `hsl(${hue} 30% 50% / 0.14)`,
        color: `color-mix(in srgb, hsl(${hue} 35% 38%) 70%, var(--app-ink))`,
      }}
      aria-hidden
    >
      {initials(name) || '?'}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-subtle text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-label text-muted">{children}</div>}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({
  open,
  onClose,
  title,
  heading,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Replaces the visible title; `title` still names the dialog for screen readers. */
  heading?: ReactNode;
  /** Pinned below the scrolling content, so nothing can show through or scroll under it. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full min-w-0 flex-col rounded-t-2xl border border-line bg-surface pb-safe shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
          {heading ?? <h2 className="text-body font-semibold">{title}</h2>}
          <button onClick={onClose} className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div>
        {footer && <div className="space-y-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Two-or-more option toggle, e.g. Expense / Income. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid rounded-lg bg-subtle p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md text-label font-medium transition-colors ${
            value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Filter or choice pill. */
export function Chip({ selected, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-label font-medium transition-colors ${
        selected ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-muted hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Horizontal usage bar. `pct` is 0-100; `tone` is a background class. */
export function ProgressBar({ pct, tone = 'bg-primary', track = 'bg-subtle', className = 'h-1.5' }: { pct: number; tone?: string; track?: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-full ${track} ${className}`} aria-hidden>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Labelled figures in equal columns. */
export function StatRow({ items, className = '' }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={`grid gap-3 ${className}`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-label text-muted">{item.label}</dt>
          <dd className="mt-0.5 font-semibold tabular">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Icon, title and detail with a chevron: a link with `to`, otherwise a button. */
export function ListRow({
  to,
  onClick,
  icon: Icon,
  leading,
  title,
  detail,
  className = '',
}: {
  to?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  const classes = `flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60 active:bg-subtle ${className}`;
  const content = (
    <>
      {leading ?? (Icon && <Icon className="size-5 shrink-0 text-muted" strokeWidth={1.75} />)}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{title}</span>
        {detail && <span className="block truncate text-label text-muted">{detail}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </>
  );
  return to ? (
    <Link to={to} className={classes}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}

/** Placeholder blocks shaped like a summary card and a list, shown while a page loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-5 motion-safe:animate-pulse" role="status" aria-label="Loading">
      <div className="h-36 rounded-xl bg-subtle" />
      <div className="h-4 w-28 rounded bg-subtle" />
      <div className="h-48 rounded-xl bg-subtle" />
    </div>
  );
}
