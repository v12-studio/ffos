import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartColumn, Check, ChevronLeft, ChevronRight, ChevronsUpDown, FileUp, House, List, PiggyBank, Plus, RotateCcw, Settings, Users } from 'lucide-react';
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useMatch, useSearchParams } from 'react-router';
import { BOOK_COLORS, BOOK_TEMPLATE_LABELS, BOOK_TEMPLATES, formatMoney, type BookDTO, type BookTemplate, type CategoryDTO, type DeletedBookDTO, type TransactionDTO } from '@ffos/shared';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { useMembers } from '../lib/budget.ts';
import { currentMonth, dayLabel, monthBounds, monthLabel, periodRangeLabel, shiftMonth, todayISO } from '../lib/format.ts';
import { useTheme } from '../lib/theme.ts';
import { preloadRoute, preloadTabsWhenIdle } from '../pages/lazy.ts';
import { Logo } from './auth-ui.tsx';
import { ColourPicker, CurrencySelect } from './BookFields.tsx';
import { CategoryTile } from './CategoryIcon.tsx';
import { OutboxSync } from './OutboxSync.tsx';
import { useToast } from './Toast.tsx';
import { TransactionSheet } from './TransactionSheet.tsx';
import { Button, ErrorBanner, Field, fieldErrors, PageSkeleton, RoleBadge, Sheet, Spinner } from './ui.tsx';

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
  return month > now ? monthBounds(month).from : monthBounds(month).to;
}

// Spot in the phone header where a tab page puts its control (the month switcher), so title and month share one row.
const HeaderSlotContext = createContext<HTMLElement | null>(null);

// Phone tab bar: 2 tabs · Add · 2 tabs. Members lives in Settings on phones and in the sidebar on desktop.
const OVERVIEW = { to: '/', label: 'Overview', icon: House, end: true };
const TRANSACTIONS = { to: '/transactions', label: 'Transactions', icon: List, end: false };
const BUDGET = { to: '/budget', label: 'Budget', icon: PiggyBank, end: false };
const REPORTS = { to: '/reports', label: 'Reports', icon: ChartColumn, end: false };
const SETTINGS = { to: '/more', label: 'Settings', icon: Settings, end: false };
const SIDEBAR_NAV = [OVERVIEW, TRANSACTIONS, BUDGET, REPORTS, { to: '/members', label: 'Members', icon: Users, end: false }, SETTINGS];

/** Start downloading a tab's code as soon as the pointer or focus lands on its link. */
const preloadProps = (to: string) => {
  const preload = preloadRoute[to];
  if (!preload) return {};
  const go = () => void preload().catch(() => undefined);
  return { onPointerEnter: go, onTouchStart: go, onFocus: go };
};

export function AppShell() {
  const { book, can } = useCurrentBook();
  const [prefs] = useTheme();
  // Phones: two tabs · Add · two tabs. The third is Budget or Reports, as the person chose.
  const NAV = [OVERVIEW, TRANSACTIONS, prefs.tab === 'reports' ? REPORTS : BUDGET, SETTINGS];
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
  useEffect(preloadTabsWhenIdle, []);

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
                {...preloadProps(to)}
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
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
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

function TabLink({ to, label, icon: Icon, end }: typeof OVERVIEW) {
  return (
    <NavLink
      to={to}
      end={end}
      {...preloadProps(to)}
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
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const freshForm = () => ({ name: '', currency: book.currency, color: BOOK_COLORS[books.length % BOOK_COLORS.length]!, template: 'household' as BookTemplate });
  const [form, setForm] = useState(freshForm);
  const create = useMutation({
    mutationFn: () => api.post<BookDTO>('/books', form),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      selectBook(created.id);
      setCreating(false);
      setForm(freshForm());
      onClose();
    },
  });
  const errors = fieldErrors(create.error);
  // Books this person deleted lately, which they can bring back.
  const deleted = useQuery({
    queryKey: ['books', 'deleted'],
    queryFn: () => api.get<DeletedBookDTO[]>('/books/deleted'),
    enabled: open,
  });
  // A JSON backup (Export → Everything → JSON) comes back as a new book.
  const fromBackup = useMutation({
    mutationFn: async (file: File) => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't a backup. Pick the .json file made by Export → Everything → JSON backup.");
      }
      return api.post<{ book: BookDTO; counts: { transactions: number; skipped: number } }>('/books/import', data);
    },
    onSuccess: async ({ book: restored, counts }) => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      selectBook(restored.id);
      toast({ message: `${restored.name}: ${counts.transactions} transactions restored`, duration: 3500 });
      onClose();
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post<BookDTO>(`/books/${id}/restore`),
    onSuccess: async (restored) => {
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      selectBook(restored.id);
      onClose();
    },
  });

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
          <CurrencySelect value={form.currency} error={errors.currency} onChange={(currency) => setForm({ ...form, currency })} />
          <ColourPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
          <fieldset>
            <legend className="mb-1.5 text-label font-medium">Start with categories for</legend>
            <div className="grid grid-cols-2 gap-2">
              {BOOK_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, template: t })}
                  aria-pressed={form.template === t}
                  className={`rounded-lg border px-3 py-2 text-left ${form.template === t ? 'border-primary bg-subtle ring-1 ring-primary' : 'border-line hover:bg-subtle/60'}`}
                >
                  <span className="block text-label font-medium">{BOOK_TEMPLATE_LABELS[t].name}</span>
                  <span className="block text-caption text-muted">{BOOK_TEMPLATE_LABELS[t].description}</span>
                </button>
              ))}
            </div>
          </fieldset>
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
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New book
          </Button>
          <label className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium hover:bg-subtle ${fromBackup.isPending ? 'pointer-events-none opacity-50' : ''}`}>
            {fromBackup.isPending ? <Spinner className="size-4" /> : <FileUp className="size-4" />} Restore a backup
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) fromBackup.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
      <ErrorBanner error={fromBackup.error} />

      {!creating && (deleted.data?.length ?? 0) > 0 && (
        <section className="mt-6">
          <p className="mb-1.5 text-caption font-medium text-muted">Recently deleted</p>
          <div className="overflow-hidden rounded-xl border border-line">
            {deleted.data!.map((b) => (
              <div key={b.id} className="flex min-h-14 items-center gap-3 border-b border-line px-4 last:border-b-0">
                <span className="size-2.5 shrink-0 rounded-[3px] opacity-50" style={{ backgroundColor: b.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-muted">{b.name}</span>
                  <span className="text-caption text-muted">Can be restored until {new Date(b.restoreUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                </span>
                <Button variant="secondary" className="min-h-9! px-3 text-label" loading={restore.isPending && restore.variables === b.id} onClick={() => restore.mutate(b.id)}>
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
              </div>
            ))}
          </div>
          <ErrorBanner error={restore.error} />
        </section>
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
  // Months that start on salary day show their dates, e.g. 25 Sep – 24 Oct.
  const range = periodRangeLabel(month);
  return (
    <div className="flex shrink-0 items-center rounded-lg border border-line bg-surface">
      <button onClick={() => onChange(shiftMonth(month, -1))} className={btn} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </button>
      <span className="flex min-w-[4.75rem] flex-col items-center text-center whitespace-nowrap" aria-label={`${monthLabel(month)}${range ? `, ${range}` : ''}`}>
        <span className="text-label leading-tight font-semibold">{shortMonthLabel(month)}</span>
        {range && <span className="text-[0.625rem] leading-tight text-muted">{range}</span>}
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
  selected,
  onSelect,
}: {
  txn: TransactionDTO;
  category?: CategoryDTO;
  currency: string;
  showDate?: boolean;
  /** Select mode: tapping ticks the row instead of opening it. */
  selected?: boolean;
  onSelect?: () => void;
}) {
  const open = useOpenTransaction();
  const { book } = useCurrentBook();
  const members = useMembers(book.id, book.memberCount > 1 && Boolean(txn.forMemberId));
  const forName = txn.forMemberId ? members.data?.find((m) => m.userId === txn.forMemberId)?.name.split(' ')[0] : null;
  const detail = [
    txn.note ? category?.name : null,
    showDate ? dayLabel(txn.date) : null,
    forName ? `for ${forName}` : null,
    book.memberCount > 1 ? `by ${txn.createdByName}` : null,
    txn.tags?.length ? txn.tags.map((t) => `#${t}`).join(' ') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      onClick={() => (onSelect ? onSelect() : open(txn))}
      aria-pressed={onSelect ? Boolean(selected) : undefined}
      className={`flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60 active:bg-subtle ${selected ? 'bg-primary/5' : ''}`}
    >
      {onSelect && (
        <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${selected ? 'border-primary bg-primary text-primary-fg' : 'border-line'}`} aria-hidden>
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
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
