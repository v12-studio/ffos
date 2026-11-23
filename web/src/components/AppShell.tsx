import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, House, List, PiggyBank, Plus, Settings, Users } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useMatch, useSearchParams } from 'react-router';
import { formatMoney, type BookDTO, type CategoryDTO, type TransactionDTO } from '@ffos/shared';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, dayLabel, monthLabel, shiftMonth, todayISO } from '../lib/format.ts';
import { Logo } from './auth-ui.tsx';
import { CategoryTile } from './CategoryIcon.tsx';
import { OutboxSync } from './OutboxSync.tsx';
import { TransactionSheet } from './TransactionSheet.tsx';
import { Button, ErrorBanner, Field, fieldErrors, RoleBadge, Sheet } from './ui.tsx';

// ── transaction sheet is app-wide so the Add button works from any tab ──
/** Starting values for a new entry, e.g. the budget head it was added from. */
export interface TransactionPrefill {
  categoryId?: string;
  /** Minor units, e.g. what's still to pay on a bill. */
  amount?: number;
  note?: string;
}
const TxnSheetContext = createContext<(t?: TransactionDTO, prefill?: TransactionPrefill) => void>(() => undefined);
export const useOpenTransaction = () => useContext(TxnSheetContext);

// The month the current page is showing, so a new entry lands in that month rather than always today.
const ViewedMonthContext = createContext<(month: string | null) => void>(() => undefined);
export function useViewedMonth(month: string | null) {
  const setViewedMonth = useContext(ViewedMonthContext);
  useEffect(() => {
    setViewedMonth(month);
    return () => setViewedMonth(null);
  }, [month, setViewedMonth]);
}

/** Today in this month; otherwise the last day of a past month or the first day of a future one. */
function defaultDate(month: string | null): string {
  const now = currentMonth();
  if (!month || month === now) return todayISO();
  if (month > now) return `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

// Spot in the phone header where a tab page puts its control (the month switcher), so title and month share one row.
const HeaderSlotContext = createContext<HTMLElement | null>(null);

// Phone tab bar: 2 tabs · Add · 2 tabs. Members lives in Settings on phones and in the sidebar on desktop.
const NAV = [
  { to: '/', label: 'Overview', icon: House, end: true },
  { to: '/transactions', label: 'Transactions', icon: List, end: false },
  { to: '/budget', label: 'Budget', icon: PiggyBank, end: false },
  { to: '/more', label: 'Settings', icon: Settings, end: false },
];
const SIDEBAR_NAV = [...NAV.slice(0, 3), { to: '/members', label: 'Members', icon: Users, end: false }, NAV[3]!];

export function AppShell() {
  const { book, can } = useCurrentBook();
  const [booksOpen, setBooksOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [viewedMonth, setViewedMonth] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; txn: TransactionDTO | null; prefill: TransactionPrefill & { date: string } }>({
    open: false,
    txn: null,
    prefill: { date: todayISO() },
  });
  const openTransaction = (txn?: TransactionDTO, prefill?: TransactionPrefill) =>
    setSheet({ open: true, txn: txn ?? null, prefill: { ...prefill, date: defaultDate(viewedMonth) } });
  const canAdd = can('txn.create');

  // The installed app's "Add expense" shortcut opens with ?add=expense: go straight to the keypad.
  const [params, setParams] = useSearchParams();
  const addParam = params.get('add');
  useEffect(() => {
    if (addParam === null) return;
    if (canAdd) openTransaction();
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [addParam]);
  // The plan editor has its own bottom bar for the total and Save.
  const hideTabBar = useMatch('/budget/:month/edit') !== null;

  const bookSwitcher = (
    <button
      onClick={() => setBooksOpen(true)}
      className="flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-subtle"
      aria-label={`Current book: ${book.name}. Switch book`}
    >
      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: book.color }} />
      <span className="truncate text-body font-semibold">{book.name}</span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted" />
    </button>
  );

  return (
    <TxnSheetContext.Provider value={openTransaction}>
      <ViewedMonthContext.Provider value={setViewedMonth}>
      <HeaderSlotContext.Provider value={headerSlot}>
      <div className="min-h-dvh lg:flex">
        {/* desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
          <div className="mb-5 flex items-center gap-2.5 px-2">
            <Logo className="size-6" />
            <span className="text-label font-semibold tracking-tight">Family Finance OS</span>
          </div>
          <div className="mb-4 rounded-lg border border-line">{bookSwitcher}</div>
          <nav className="flex flex-col gap-0.5">
            {SIDEBAR_NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-label font-medium transition-colors ${
                    isActive ? 'bg-subtle text-ink' : 'text-muted hover:bg-subtle hover:text-ink'
                  }`
                }
              >
                <Icon className="size-4" /> {label}
              </NavLink>
            ))}
          </nav>
          {canAdd && (
            <Button className="mt-auto" onClick={() => openTransaction()}>
              <Plus className="size-4" /> New transaction
            </Button>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-line bg-surface pt-safe lg:hidden">
            <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-2">
              {bookSwitcher}
              {book.role !== 'owner' && <RoleBadge role={book.role} />}
              <div ref={setHeaderSlot} className="ml-auto flex shrink-0 items-center pr-1 empty:hidden" />
            </div>
          </header>

          <main className="mx-auto max-w-2xl px-4 pt-4 pb-28 lg:max-w-3xl lg:px-8 lg:pt-8 lg:pb-12">
            <OutboxSync />
            <Outlet />
          </main>
        </div>

        {/* mobile tab bar */}
        <nav className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-safe lg:hidden ${hideTabBar ? 'hidden' : ''}`}>
          <div className="mx-auto grid h-16 max-w-2xl grid-cols-5 items-center">
            {NAV.slice(0, 2).map((item) => (
              <TabLink key={item.to} {...item} />
            ))}
            <div className="grid place-items-center">
              {canAdd && (
                <button
                  onClick={() => openTransaction()}
                  className="grid size-11 place-items-center rounded-xl bg-primary text-primary-fg active:bg-primary/80"
                  aria-label="Add transaction"
                >
                  <Plus className="size-5" strokeWidth={2.25} />
                </button>
              )}
            </div>
            {NAV.slice(2).map((item) => (
              <TabLink key={item.to} {...item} />
            ))}
          </div>
        </nav>
      </div>

      <BooksSheet open={booksOpen} onClose={() => setBooksOpen(false)} />
      <TransactionSheet
        open={sheet.open}
        transaction={sheet.txn}
        prefill={sheet.prefill}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
      />
      </HeaderSlotContext.Provider>
      </ViewedMonthContext.Provider>
    </TxnSheetContext.Provider>
  );
}

function TabLink({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-full flex-col items-center justify-center gap-1 text-micro font-medium ${isActive ? 'text-ink' : 'text-muted'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="size-[22px]" strokeWidth={isActive ? 2.1 : 1.6} />
          {label}
        </>
      )}
    </NavLink>
  );
}

function BooksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { books, book, selectBook } = useCurrentBook();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', currency: book.currency });
  const create = useMutation({
    mutationFn: () => api.post<BookDTO>('/books', form),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      selectBook(created.id);
      setCreating(false);
      setForm({ name: '', currency: created.currency });
      onClose();
    },
  });
  const errors = fieldErrors(create.error);

  return (
    <Sheet open={open} onClose={onClose} title="Books">
      <div className="overflow-hidden rounded-xl border border-line">
        {books.map((b) => (
          <button
            key={b.id}
            onClick={() => {
              selectBook(b.id);
              onClose();
            }}
            className="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 text-left last:border-b-0 hover:bg-subtle"
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: b.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium">{b.name}</span>
              <span className="text-caption text-muted">
                {b.isPersonal ? 'Private' : `${b.memberCount} member${b.memberCount === 1 ? '' : 's'}`} · {b.currency}
              </span>
            </span>
            <RoleBadge role={b.role} />
            <Check className={`size-4 shrink-0 ${b.id === book.id ? 'text-accent' : 'invisible'}`} />
          </button>
        ))}
      </div>

      {creating ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ErrorBanner error={Object.keys(errors).length ? null : create.error} />
          <Field label="Book name" placeholder="e.g. Household, Parents, Goa trip" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required />
          <Field label="Currency" maxLength={3} value={form.currency} error={errors.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={create.isPending}>
              Create book
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New book
        </Button>
      )}
    </Sheet>
  );
}

/** "Nov 2026": short enough to sit beside any page title. */
function shortMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const btn = 'grid size-11 place-items-center text-muted hover:text-ink';
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-line bg-surface">
      <button onClick={() => onChange(shiftMonth(month, -1))} className={btn} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[4.75rem] text-center text-label font-semibold whitespace-nowrap" aria-label={monthLabel(month)}>
        {shortMonthLabel(month)}
      </span>
      <button onClick={() => onChange(shiftMonth(month, 1))} className={btn} aria-label="Next month">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function Amount({ txn, currency, className = '' }: { txn: Pick<TransactionDTO, 'type' | 'amount'>; currency: string; className?: string }) {
  return (
    <span className={`tabular font-semibold ${txn.type === 'income' ? 'text-positive' : 'text-ink'} ${className}`}>
      {txn.type === 'income' ? '+' : '−'}
      {formatMoney(txn.amount, currency)}
    </span>
  );
}

export function TransactionRow({
  txn,
  category,
  currency,
  showDate,
}: {
  txn: TransactionDTO;
  category?: CategoryDTO;
  currency: string;
  showDate?: boolean;
}) {
  const open = useOpenTransaction();
  const { book } = useCurrentBook();
  const detail = [
    txn.note ? category?.name : null,
    showDate ? dayLabel(txn.date) : null,
    book.memberCount > 1 ? `by ${txn.createdByName}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button onClick={() => open(txn)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60 active:bg-subtle">
      <CategoryTile category={category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{txn.note || category?.name || 'Transaction'}</span>
        {detail && <span className="block truncate text-label text-muted">{detail}</span>}
      </span>
      <Amount txn={txn} currency={currency} className="shrink-0 text-body" />
    </button>
  );
}

/**
 * Page heading. `tab` marks a page reached from the tab bar: on phones its title is already shown by the
 * highlighted tab, so it's only read to screen readers and `action` moves up into the header row.
 */
export function PageTitle({ children, action, subtitle, tab }: { children: ReactNode; action?: ReactNode; subtitle?: ReactNode; tab?: boolean }) {
  const slot = useContext(HeaderSlotContext);
  if (tab) {
    return (
      <>
        <h1 className="sr-only lg:hidden">{children}</h1>
        {slot && action && createPortal(<div className="lg:hidden">{action}</div>, slot)}
        <div className="mb-5 hidden items-center justify-between gap-3 lg:flex">
          <h1 className="text-title font-semibold tracking-tight">{children}</h1>
          {action}
        </div>
      </>
    );
  }
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-title font-semibold tracking-tight">{children}</h1>
        {subtitle && <p className="mt-0.5 text-label text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
