import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ReceiptText, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatMoney, type CategoryDTO, type TransactionDTO, type TransactionSearchDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Card, EmptyState, ErrorBanner, inputClass, Segmented, Sheet, Spinner } from '../components/ui.tsx';
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
  const [pickingCategory, setPickingCategory] = useState(false);
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

  const chips: [Filter, string][] = [
    ['all', 'All'],
    ['expense', 'Expenses'],
    ['income', 'Income'],
    ['mine', 'Added by me'],
  ];
  const chipClass = (on: boolean) =>
    `flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
      on ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-muted hover:text-ink'
    }`;
  const narrowed = Boolean(search || filter !== 'all' || categoryId);

  return (
    <div className="space-y-5">
      <PageTitle action={scope === 'month' && <MonthSwitcher month={month} onChange={(m) => setParam('month', m === currentMonth() ? null : m)} />}>
        Transactions
      </PageTitle>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={scope === 'all' ? 'Search every month: notes, categories, people' : 'Search notes, categories, people'}
            className={`${inputClass} pl-10`}
          />
        </div>
        <Segmented
          value={scope}
          onChange={(s) => setParam('scope', s === 'all' ? 'all' : null)}
          options={[
            { value: 'month', label: monthLabel(month) },
            { value: 'all', label: 'All months' },
          ]}
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {category ? (
          <button onClick={() => setParam('category', null)} className={chipClass(true)} aria-label={`Showing ${category.name} only. Clear`}>
            {category.name}
            <X className="size-3.5" />
          </button>
        ) : (
          <button onClick={() => setPickingCategory(true)} className={chipClass(false)}>
            Category <ChevronDown className="size-3.5" />
          </button>
        )}
        {chips.map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} className={chipClass(filter === value)}>
            {label}
          </button>
        ))}
      </div>

      {category && rows.length > 0 && (
        <p className="-mt-2 px-0.5 text-[13px] text-muted tabular">
          {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {formatMoney(Math.abs(netOf(rows)), book.currency)}{' '}
          {scope === 'month' ? `in ${monthLabel(month)}` : allTxns.data?.truncated ? 'in the latest matches' : 'in total'}
        </p>
      )}

      <ErrorBanner error={active.error} />
      {active.isLoading ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
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
        groups.map(([key, groupRows]) => {
          const net = netOf(groupRows);
          return (
            <section key={key}>
              <div className="mb-2 flex justify-between px-0.5 text-[13px]">
                <span className="font-semibold text-muted">{scope === 'all' ? monthLabel(key) : dayLabel(key)}</span>
                <span className="text-muted tabular">
                  {net < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(net), book.currency)}
                </span>
              </div>
              <Card className="divide-y divide-line overflow-hidden">
                {groupRows.map((t) => (
                  <TransactionRow key={t.id} txn={t} category={byId.get(t.categoryId)} currency={book.currency} showDate={scope === 'all'} />
                ))}
              </Card>
            </section>
          );
        })
      )}

      {scope === 'all' && allTxns.data?.truncated && (
        <p className="px-0.5 text-center text-[13px] text-muted">Showing the latest 200 matches. Search for something more specific to see older ones.</p>
      )}

      {can('txn.delete.own') && (
        <Link
          to="/transactions/deleted"
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted hover:bg-subtle hover:text-ink"
        >
          <Trash2 className="size-4" /> Recently deleted
        </Link>
      )}

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
              <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
              <div className="overflow-hidden rounded-xl border border-line">
                {list.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onPick(c.id)}
                    className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-[15px] last:border-b-0 hover:bg-subtle"
                  >
                    <CategoryTile category={c} size="sm" />
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
