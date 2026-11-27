import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, ReceiptText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatMoney, type CategoryDTO, type TransactionDTO, type TransactionSearchDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useViewedMonth } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Card, Chip, EmptyState, ErrorBanner, inputClass, PageSkeleton, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, dayLabel, monthLabel } from '../lib/format.ts';

type Filter = 'all' | 'expense' | 'income' | 'mine';
type Scope = 'month' | 'all';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const netOf = (rows: TransactionDTO[]) => rows.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);

/**
 * URL: ?month=YYYY-MM (default this month), ?category=<id> to show one category,
 * ?scope=all to search every month instead of one.
 */
export function TransactionsPage() {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonth();
  const categoryId = params.get('category');
  const scope: Scope = params.get('scope') === 'all' ? 'all' : 'month';
  useViewedMonth(scope === 'month' ? month : null);
  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const categories = useCategories(book.id);
  const byId = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const category = categoryId ? byId.get(categoryId) : undefined;

  const monthTxns = useQuery({
    queryKey: ['book', book.id, 'transactions', month],
    queryFn: () => api.get<TransactionDTO[]>(`/books/${book.id}/transactions?month=${month}`),
    refetchInterval: 60_000,
    enabled: scope === 'month',
  });

  // Every month: the server searches, so filters go in the request.
  const searchParams = new URLSearchParams();
  if (q) searchParams.set('q', q);
  if (categoryId) searchParams.set('category', categoryId);
  if (filter === 'expense' || filter === 'income') searchParams.set('type', filter);
  if (filter === 'mine' && user) searchParams.set('createdBy', user.id);
  const allTxns = useQuery({
    queryKey: ['book', book.id, 'transactions', 'search', searchParams.toString()],
    queryFn: () => api.get<TransactionSearchDTO>(`/books/${book.id}/transactions/search?${searchParams}`),
    enabled: scope === 'all',
    placeholderData: (prev) => prev,
  });

  const active = scope === 'all' ? allTxns : monthTxns;

  const rows = useMemo(() => {
    if (scope === 'all') return allTxns.data?.items ?? [];
    const text = search.trim().toLowerCase();
    return (monthTxns.data ?? []).filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false;
      if (filter === 'mine' && t.createdBy !== user?.id) return false;
      if ((filter === 'expense' || filter === 'income') && t.type !== filter) return false;
      if (!text) return true;
      const cat = byId.get(t.categoryId)?.name ?? '';
      return `${t.note} ${cat} ${t.createdByName}`.toLowerCase().includes(text);
    });
  }, [scope, allTxns.data, monthTxns.data, search, categoryId, filter, user?.id, byId]);

  // One month: grouped by day. Every month: grouped by month, each row shows its date.
  const groups = useMemo(() => {
    const keyOf = (t: TransactionDTO) => (scope === 'all' ? t.date.slice(0, 7) : t.date);
    const map = new Map<string, TransactionDTO[]>();
    for (const t of rows) map.set(keyOf(t), [...(map.get(keyOf(t)) ?? []), t]);
    return [...map.entries()];
  }, [rows, scope]);

  // No chip selected means everything; tapping the selected one clears it.
  const chips: [Filter, string][] = [
    ['expense', 'Expenses'],
    ['income', 'Income'],
    ['mine', 'Mine'],
  ];
  const totalIn = rows.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : 0), 0);
  const totalOut = rows.reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : 0), 0);
  const narrowed = Boolean(search || filter !== 'all' || categoryId);

  return (
    <div className="space-y-4">
      <PageTitle tab action={scope === 'month' && <MonthSwitcher month={month} onChange={(m) => setParam('month', m === currentMonth() ? null : m)} />}>
        Transactions
      </PageTitle>

      {/* Search stays out of the way until asked for, so the list starts higher. */}
      {(searching || search) && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            autoFocus={!search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => !search && setSearching(false)}
            placeholder={scope === 'all' ? 'Search every month: notes, categories, people' : 'Search notes, categories, people'}
            className={`${inputClass} pr-10 pl-10`}
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSearch('');
              setSearching(false);
            }}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink"
            aria-label="Close search"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Fades at the edge so a chip cut off by the screen reads as "scroll for more". */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] lg:mx-0 lg:px-0 lg:[mask-image:none]">
        {!searching && !search && (
          <Chip onClick={() => setSearching(true)} aria-label="Search" className="px-2.5">
            <Search className="size-4" />
          </Chip>
        )}
        {chips.map(([value, label]) => (
          <Chip key={value} selected={filter === value} onClick={() => setFilter(filter === value ? 'all' : value)}>
            {label}
          </Chip>
        ))}
        {category ? (
          <Chip selected onClick={() => setParam('category', null)} aria-label={`Showing ${category.name} only. Clear`}>
            {category.name}
            <X className="size-3.5" />
          </Chip>
        ) : (
          <Chip onClick={() => setPickingCategory(true)}>
            Category <ChevronDown className="size-3.5" />
          </Chip>
        )}
        <Chip selected={scope === 'all'} onClick={() => setParam('scope', scope === 'all' ? null : 'all')}>
          All months
        </Chip>
      </div>

      {rows.length > 0 && (
        <div className="-mt-2 flex min-h-9 items-center gap-2 px-0.5">
          <p className="min-w-0 flex-1 text-label text-muted tabular">
            {category ? (
              <>
                {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {formatMoney(Math.abs(netOf(rows)), book.currency)}{' '}
                {scope === 'month' ? `in ${monthLabel(month)}` : allTxns.data?.truncated ? 'in the latest matches' : 'in total'}
              </>
            ) : (
              !(scope === 'all' && allTxns.data?.truncated) && (
                <>
                  In <span className="font-semibold text-ink">{formatMoney(totalIn, book.currency)}</span> · Out{' '}
                  <span className="font-semibold text-ink">{formatMoney(totalOut, book.currency)}</span>
                </>
              )
            )}
          </p>
          {can('book.export') && (
            <button
              onClick={() => setExporting(true)}
              className="-mr-2 flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-label font-medium text-accent hover:bg-subtle"
            >
              <Download className="size-3.5" /> Export
            </button>
          )}
        </div>
      )}

      <ErrorBanner error={active.error} />
      {active.isLoading ? (
        <PageSkeleton />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ReceiptText className="size-5" />}
            title={narrowed ? 'No matching transactions' : scope === 'all' ? 'No transactions yet' : 'No transactions this month'}
          >
            {scope === 'month' && narrowed && (
              <button onClick={() => setParam('scope', 'all')} className="mt-1 font-medium text-accent">
                Search all months
              </button>
            )}
          </EmptyState>
        </Card>
      ) : (
        // One list with day headings inside it, rather than a card per day.
        <Card className="overflow-hidden">
          {groups.map(([key, groupRows]) => {
            const net = netOf(groupRows);
            return (
              <section key={key} className="group">
                <div className="flex min-h-8 items-center justify-between border-y border-line bg-subtle/70 px-4 text-caption group-first:border-t-0">
                  <span className="font-semibold text-muted">{scope === 'all' ? monthLabel(key) : dayLabel(key)}</span>
                  {/* With one entry this would just repeat its amount. */}
                  {groupRows.length > 1 && (
                    <span className="text-muted tabular">
                      {net < 0 ? '−' : '+'}
                      {formatMoney(Math.abs(net), book.currency)}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-line">
                  {groupRows.map((t) => (
                    <TransactionRow key={t.id} txn={t} category={byId.get(t.categoryId)} currency={book.currency} showDate={scope === 'all'} />
                  ))}
                </div>
              </section>
            );
          })}
        </Card>
      )}

      {scope === 'all' && allTxns.data?.truncated && (
        <p className="px-0.5 text-center text-label text-muted">Showing the latest 200 matches. Search for something more specific to see older ones.</p>
      )}

      <ExportSheet
        open={exporting}
        onClose={() => setExporting(false)}
        preset={{ what: 'transactions', period: scope === 'all' ? 'all' : 'month', month, categoryId }}
      />
      <CategoryPickerSheet
        open={pickingCategory}
        categories={categories.data ?? []}
        onClose={() => setPickingCategory(false)}
        onPick={(id) => {
          setParam('category', id);
          setPickingCategory(false);
        }}
      />
    </div>
  );
}

function CategoryPickerSheet({
  open,
  categories,
  onClose,
  onPick,
}: {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const groups: [string, CategoryDTO[]][] = [
    ['Expense', categories.filter((c) => c.kind === 'expense' && !c.archived)],
    ['Income', categories.filter((c) => c.kind === 'income' && !c.archived)],
    ['Hidden', categories.filter((c) => c.archived)],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Show one category">
      <div className="space-y-4">
        {groups
          .filter(([, list]) => list.length)
          .map(([label, list]) => (
            <section key={label}>
              <p className="mb-1.5 text-caption font-medium text-muted">{label}</p>
              <div className="overflow-hidden rounded-xl border border-line">
                {list.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onPick(c.id)}
                    className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-subtle"
                  >
                    <CategoryTile category={c} />
                    {c.name}
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </Sheet>
  );
}
