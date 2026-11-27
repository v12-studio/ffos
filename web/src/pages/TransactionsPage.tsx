import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, ChevronDown, Download, ReceiptText, Search, SlidersHorizontal, Tag, Tags, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatMoney, toMinor, type CategoryDTO, type TagDTO, type TransactionDTO, type TransactionSearchDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useViewedMonth } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, Chip, EmptyState, ErrorBanner, inputClass, PageSkeleton, Segmented, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { useMembers } from '../lib/budget.ts';
import { useAccounts } from '../lib/accounts.ts';
import { currentMonth, dayLabel, monthLabel, periodOfDate } from '../lib/format.ts';

type Filter = 'all' | 'expense' | 'income' | 'mine';

interface Advanced {
  from: string;
  to: string;
  min: string;
  max: string;
  tag: string;
  forMember: string;
  account: string;
  sort: 'newest' | 'oldest' | 'largest' | 'smallest';
}
const NO_FILTERS: Advanced = { from: '', to: '', min: '', max: '', tag: '', forMember: '', account: '', sort: 'newest' };
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
  // A date range always searches across months.
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adv, setAdv] = useState<Advanced>(NO_FILTERS);
  const advCount = Object.entries(adv).filter(([k, v]) => v && !(k === 'sort' && v === 'newest')).length;
  // Select mode: tick entries, then change them together.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [bulkPanel, setBulkPanel] = useState<'category' | 'tag' | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
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
  const minMinor = adv.min ? toMinor(adv.min) : null;
  const maxMinor = adv.max ? toMinor(adv.max) : null;
  if (adv.from) searchParams.set('from', adv.from);
  if (adv.to) searchParams.set('to', adv.to);
  if (minMinor !== null) searchParams.set('min', String(minMinor));
  if (maxMinor !== null) searchParams.set('max', String(maxMinor));
  if (adv.tag) searchParams.set('tag', adv.tag);
  if (adv.forMember) searchParams.set('forMember', adv.forMember);
  if (adv.account) searchParams.set('account', adv.account);
  if (adv.sort !== 'newest') searchParams.set('sort', adv.sort);
  const allTxns = useInfiniteQuery({
    queryKey: ['book', book.id, 'transactions', 'search', searchParams.toString()],
    queryFn: ({ pageParam }) => api.get<TransactionSearchDTO>(`/books/${book.id}/transactions/search?${searchParams}&page=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.truncated ? all.length : undefined),
    enabled: scope === 'all',
    placeholderData: (prev) => prev,
  });
  const allItems = useMemo(() => allTxns.data?.pages.flatMap((p) => p.items) ?? [], [allTxns.data]);
  const serverTotals = allTxns.data?.pages[0]?.totals;

  const active = scope === 'all' ? allTxns : monthTxns;

  const rows = useMemo(() => {
    if (scope === 'all') return allItems;
    const text = search.trim().toLowerCase();
    const list = (monthTxns.data ?? []).filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false;
      if (filter === 'mine' && t.createdBy !== user?.id) return false;
      if ((filter === 'expense' || filter === 'income') && t.type !== filter) return false;
      if (minMinor !== null && t.amount < minMinor) return false;
      if (maxMinor !== null && t.amount > maxMinor) return false;
      if (adv.tag && !t.tags?.some((x) => x.toLowerCase() === adv.tag.toLowerCase())) return false;
      if (adv.forMember && t.forMemberId !== adv.forMember) return false;
      if (adv.account && t.accountId !== adv.account) return false;
      if (!text) return true;
      const cat = byId.get(t.categoryId)?.name ?? '';
      return `${t.note} ${cat} ${t.createdByName} ${(t.tags ?? []).join(' ')}`.toLowerCase().includes(text);
    });
    if (adv.sort === 'largest') return [...list].sort((a, b) => b.amount - a.amount);
    if (adv.sort === 'smallest') return [...list].sort((a, b) => a.amount - b.amount);
    if (adv.sort === 'oldest') return [...list].reverse();
    return list;
  }, [scope, allItems, monthTxns.data, search, categoryId, filter, user?.id, byId, adv, minMinor, maxMinor]);

  const bulk = useMutation({
    mutationFn: (body: { action: string; categoryId?: string; tag?: string; ids?: string[] }) =>
      api.post<{ changed: number; skipped: number }>(`/books/${book.id}/transactions/bulk`, { ids: [...(selected ?? [])], ...body }),
    onSuccess: (res, body) => {
      queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      const ids = [...(selected ?? [])];
      setSelected(null);
      setBulkPanel(null);
      const skipped = res.skipped ? ` ${res.skipped} couldn't be changed (added by someone else, or the wrong kind).` : '';
      if (body.action === 'delete') {
        toast({
          message: `Deleted ${res.changed} transaction${res.changed === 1 ? '' : 's'}.${skipped}`,
          action: {
            label: 'Undo',
            onClick: async () => {
              await api.post(`/books/${book.id}/transactions/bulk`, { ids, action: 'restore' }).catch(() => undefined);
              queryClient.invalidateQueries({ queryKey: ['book', book.id] });
            },
          },
        });
      } else toast({ message: `Changed ${res.changed} transaction${res.changed === 1 ? '' : 's'}.${skipped}`, duration: 3500 });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : "Couldn't change them" }),
  });
  const toggle = (id: string) =>
    setSelected((sel) => {
      const next = new Set(sel ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // One month: grouped by day. Every month: grouped by month, each row shows its date.
  const groups = useMemo(() => {
    const keyOf = (t: TransactionDTO) => (scope === 'all' ? periodOfDate(t.date) : t.date);
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
  // Across months the server totals every match, not just the pages loaded so far.
  const totalIn = scope === 'all' && serverTotals ? serverTotals.income : rows.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : 0), 0);
  const totalOut = scope === 'all' && serverTotals ? serverTotals.expense : rows.reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : 0), 0);
  const matchCount = scope === 'all' && serverTotals ? serverTotals.count : rows.length;
  const narrowed = Boolean(search || filter !== 'all' || categoryId || advCount);

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
        <Chip selected={advCount > 0} onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-3.5" /> Filters{advCount > 0 && ` · ${advCount}`}
        </Chip>
        {can('txn.create') && (
          <Chip selected={selected !== null} onClick={() => setSelected(selected ? null : new Set())}>
            <CheckSquare className="size-3.5" /> {selected ? 'Done' : 'Select'}
          </Chip>
        )}
      </div>

      {rows.length > 0 && (
        <div className="-mt-2 flex min-h-9 items-center gap-2 px-0.5">
          <p className="min-w-0 flex-1 text-label text-muted tabular">
            {category ? (
              <>
                {matchCount} entr{matchCount === 1 ? 'y' : 'ies'} · {formatMoney(Math.abs(totalIn - totalOut), book.currency)}{' '}
                {scope === 'month' ? `in ${monthLabel(month)}` : 'in total'}
              </>
            ) : (
              (
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
                    <TransactionRow
                      key={t.id}
                      txn={t}
                      category={byId.get(t.categoryId)}
                      currency={book.currency}
                      showDate={scope === 'all' || adv.sort !== 'newest'}
                      selected={selected?.has(t.id)}
                      onSelect={selected ? () => toggle(t.id) : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </Card>
      )}

      {scope === 'all' && allTxns.hasNextPage && (
        <Button variant="secondary" className="w-full" loading={allTxns.isFetchingNextPage} onClick={() => allTxns.fetchNextPage()}>
          Show more ({allItems.length} of {matchCount})
        </Button>
      )}

      {/* Room so the last rows aren't hidden behind the selection bar. */}
      {selected && <div className="h-14" aria-hidden />}
      {selected && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface lg:bottom-0 lg:left-60">
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5 lg:max-w-3xl lg:px-8">
            <button
              onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((t) => t.id)))}
              className="min-w-0 flex-1 truncate text-left text-label font-medium"
            >
              {selected.size} selected <span className="text-accent">· {selected.size === rows.length ? 'none' : 'all'}</span>
            </button>
            <Button variant="secondary" className="min-h-10 px-3" disabled={!selected.size || bulk.isPending} onClick={() => setBulkPanel('category')} aria-label="Change category">
              <Tags className="size-4" /> <span className="hidden sm:inline">Category</span>
            </Button>
            <Button variant="secondary" className="min-h-10 px-3" disabled={!selected.size || bulk.isPending} onClick={() => setBulkPanel('tag')} aria-label="Tag">
              <Tag className="size-4" /> <span className="hidden sm:inline">Tag</span>
            </Button>
            <Button variant="danger" className="min-h-10 px-3" disabled={!selected.size} loading={bulk.isPending && bulk.variables?.action === 'delete'} onClick={() => bulk.mutate({ action: 'delete' })} aria-label="Delete selected">
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <CategoryPickerSheet
        open={bulkPanel === 'category'}
        categories={(categories.data ?? []).filter((c) => !c.archived)}
        title={`Move ${selected?.size ?? 0} to…`}
        onClose={() => setBulkPanel(null)}
        onPick={(id) => bulk.mutate({ action: 'category', categoryId: id })}
      />
      <BulkTagSheet open={bulkPanel === 'tag'} count={selected?.size ?? 0} onClose={() => setBulkPanel(null)} onApply={(action, tag) => bulk.mutate({ action, tag })} />
      <FiltersSheet
        open={filtersOpen}
        value={adv}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setAdv(next);
          setFiltersOpen(false);
          if ((next.from || next.to) && scope !== 'all') setParam('scope', 'all');
        }}
      />

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
  title = 'Show one category',
}: {
  open: boolean;
  categories: CategoryDTO[];
  onClose: () => void;
  onPick: (id: string) => void;
  title?: string;
}) {
  const groups: [string, CategoryDTO[]][] = [
    ['Expense', categories.filter((c) => c.kind === 'expense' && !c.archived)],
    ['Income', categories.filter((c) => c.kind === 'income' && !c.archived)],
    ['Hidden', categories.filter((c) => c.archived)],
  ];
  return (
    <Sheet open={open} onClose={onClose} title={title}>
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

/** Date range, amount range, tag, person, and order. */
function FiltersSheet({ open, value, onClose, onApply }: { open: boolean; value: Advanced; onClose: () => void; onApply: (v: Advanced) => void }) {
  const { book } = useCurrentBook();
  const [form, setForm] = useState(value);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setForm(value);
  }
  const members = useMembers(book.id, open && book.memberCount > 1);
  const tags = useQuery({ queryKey: ['book', book.id, 'tags'], queryFn: () => api.get<TagDTO[]>(`/books/${book.id}/tags`), enabled: open, staleTime: 5 * 60_000 });
  const accounts = useAccounts(book.id, open);
  const badRange = Boolean(form.from && form.to && form.from > form.to);
  const badAmount = (form.min && toMinor(form.min) === null) || (form.max && toMinor(form.max) === null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onApply(NO_FILTERS)}>
            Clear
          </Button>
          <Button className="flex-1" disabled={badRange || Boolean(badAmount)} onClick={() => onApply(form)}>
            Apply
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-1.5 text-label font-medium">Dates</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-caption text-muted">From</span>
              <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-muted">To</span>
              <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} aria-invalid={badRange} className={inputClass} />
            </label>
          </div>
          <p className="mt-1.5 text-caption text-muted">{badRange ? 'The start date must come before the end date.' : 'A date range searches across months.'}</p>
        </div>
        <div>
          <p className="mb-1.5 text-label font-medium">Amount</p>
          <div className="grid grid-cols-2 gap-2">
            <input inputMode="decimal" placeholder="At least" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value.replace(/[^\d.,]/g, '') })} className={inputClass} aria-label="At least" />
            <input inputMode="decimal" placeholder="At most" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value.replace(/[^\d.,]/g, '') })} className={inputClass} aria-label="At most" />
          </div>
        </div>
        {(tags.data?.length ?? 0) > 0 && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Tag</span>
            <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} className={inputClass}>
              <option value="">Any</option>
              {tags.data!.map((t) => (
                <option key={t.tag} value={t.tag}>
                  #{t.tag} ({t.count})
                </option>
              ))}
            </select>
          </label>
        )}
        {book.memberCount > 1 && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">For</span>
            <select value={form.forMember} onChange={(e) => setForm({ ...form, forMember: e.target.value })} className={inputClass}>
              <option value="">Anyone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(accounts.data?.length ?? 0) > 0 && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Account</span>
            <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={inputClass}>
              <option value="">Any</option>
              {accounts.data!.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <p className="mb-1.5 text-label font-medium">Order</p>
          <Segmented
            value={form.sort}
            onChange={(sort) => setForm({ ...form, sort })}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'largest', label: 'Largest' },
              { value: 'smallest', label: 'Smallest' },
            ]}
          />
        </div>
      </div>
    </Sheet>
  );
}

/** Add a tag to, or remove one from, the selected entries. */
function BulkTagSheet({ open, count, onClose, onApply }: { open: boolean; count: number; onClose: () => void; onApply: (action: 'addTag' | 'removeTag', tag: string) => void }) {
  const { book } = useCurrentBook();
  const [tag, setTag] = useState('');
  const tags = useQuery({ queryKey: ['book', book.id, 'tags'], queryFn: () => api.get<TagDTO[]>(`/books/${book.id}/tags`), enabled: open, staleTime: 5 * 60_000 });
  const clean = tag.replace(/[,#]/g, '').trim().slice(0, 24);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Tag ${count} transaction${count === 1 ? '' : 's'}`}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={!clean} onClick={() => onApply('removeTag', clean)}>
            Remove tag
          </Button>
          <Button className="flex-1" disabled={!clean} onClick={() => onApply('addTag', clean)}>
            Add tag
          </Button>
        </div>
      }
    >
      <input value={tag} onChange={(e) => setTag(e.target.value)} list="bulk-tags" placeholder="e.g. trip, office" maxLength={24} className={inputClass} aria-label="Tag" autoFocus />
      <datalist id="bulk-tags">
        {(tags.data ?? []).map((t) => (
          <option key={t.tag} value={t.tag} />
        ))}
      </datalist>
      {(tags.data?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.data!.slice(0, 12).map((t) => (
            <Chip key={t.tag} selected={clean.toLowerCase() === t.tag.toLowerCase()} onClick={() => setTag(t.tag)}>
              #{t.tag}
            </Chip>
          ))}
        </div>
      )}
    </Sheet>
  );
}
