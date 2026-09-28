import { useQuery } from '@tanstack/react-query';
import { ReceiptText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMoney, type TransactionDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow } from '../components/AppShell.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Card, EmptyState, ErrorBanner, inputClass, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, dayLabel } from '../lib/format.ts';

type Filter = 'all' | 'expense' | 'income' | 'mine';

export function TransactionsPage() {
  const { book } = useCurrentBook();
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const categories = useCategories(book.id);
  const txns = useQuery({
    queryKey: ['book', book.id, 'transactions', month],
    queryFn: () => api.get<TransactionDTO[]>(`/books/${book.id}/transactions?month=${month}`),
    refetchInterval: 60_000,
  });
  const byId = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (txns.data ?? []).filter((t) => {
      if (filter === 'mine' && t.createdBy !== user?.id) return false;
      if ((filter === 'expense' || filter === 'income') && t.type !== filter) return false;
      if (!q) return true;
      const cat = byId.get(t.categoryId)?.name ?? '';
      return `${t.note} ${cat} ${t.createdByName}`.toLowerCase().includes(q);
    });
    const map = new Map<string, TransactionDTO[]>();
    for (const t of rows) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [txns.data, filter, search, user?.id, byId]);

  const chips: [Filter, string][] = [
    ['all', 'All'],
    ['expense', 'Expenses'],
    ['income', 'Income'],
    ['mine', 'Added by me'],
  ];

  return (
    <div className="space-y-5">
      <PageTitle action={<MonthSwitcher month={month} onChange={setMonth} />}>Transactions</PageTitle>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes, categories, people"
          className={`${inputClass} pl-10`}
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {chips.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`min-h-8 shrink-0 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
              filter === value ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorBanner error={txns.error} />
      {txns.isLoading ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<ReceiptText className="size-5" />} title={search || filter !== 'all' ? 'No matching transactions' : 'No transactions this month'} />
        </Card>
      ) : (
        groups.map(([date, rows]) => {
          const net = rows.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
          return (
            <section key={date}>
              <div className="mb-2 flex justify-between px-0.5 text-[13px]">
                <span className="font-semibold text-muted">{dayLabel(date)}</span>
                <span className="text-muted tabular">
                  {net < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(net), book.currency)}
                </span>
              </div>
              <Card className="divide-y divide-line overflow-hidden">
                {rows.map((t) => (
                  <TransactionRow key={t.id} txn={t} category={byId.get(t.categoryId)} currency={book.currency} />
                ))}
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}
