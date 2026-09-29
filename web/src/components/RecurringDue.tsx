import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type RecurringDueDTO } from '@ffos/shared';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { todayISO } from '../lib/format.ts';
import { useCategories } from './TransactionSheet.tsx';
import { CategoryTile } from './CategoryIcon.tsx';
import { useToast } from './Toast.tsx';
import { Button, Card, ErrorBanner } from './ui.tsx';

/** "Today", or "due 5 Sep". */
function shortDate(date: string): string {
  if (date === todayISO()) return 'due today';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `due ${new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** "3 monthly entries due. Add them?" on the Overview for the current month. */
export function RecurringDueCard({ month }: { month: string }) {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useCategories(book.id);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  // Unticked entries; anything new starts ticked.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const due = useQuery({
    queryKey: ['book', book.id, 'recurring', 'due', month],
    queryFn: () => api.get<RecurringDueDTO>(`/books/${book.id}/recurring/due?month=${month}`),
    refetchInterval: 5 * 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['book', book.id] });

  const add = useMutation({
    mutationFn: (ids: string[]) => api.post<{ added: number }>(`/books/${book.id}/recurring/due/add`, { month, ids }),
    onSuccess: ({ added }) => {
      refresh();
      setUnticked(new Set());
      toast({ message: `Added ${added} monthly entr${added === 1 ? 'y' : 'ies'}`, duration: 2500 });
    },
  });
  const skip = useMutation({
    mutationFn: (id: string) => api.post(`/books/${book.id}/recurring/${id}/skip`, { month }),
    onSuccess: refresh,
  });

  const items = due.data?.items ?? [];
  if (!items.length) return null;
  const canAdd = can('txn.create');
  const chosen = items.filter((i) => !unticked.has(i.recurring.id)).map((i) => i.recurring.id);
  const money = (n: number) => formatMoney(n, book.currency);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-muted" aria-hidden>
          <Repeat className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">
            {items.length} monthly entr{items.length === 1 ? 'y' : 'ies'} due
          </p>
          <p className="text-[13px] text-muted">{canAdd ? `Add ${items.length === 1 ? 'it' : 'them'} to this month?` : 'Someone who can add entries can record them.'}</p>
        </div>
        <Link to="/recurring" className="shrink-0 text-[13px] font-medium text-accent">
          Manage
        </Link>
      </div>

      <ul className="mt-3 divide-y divide-line border-y border-line">
        {items.map(({ recurring: r, date }) => {
          const cat = byId.get(r.categoryId);
          const ticked = !unticked.has(r.id);
          return (
            <li key={r.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              {canAdd && (
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() =>
                    setUnticked((s) => {
                      const next = new Set(s);
                      if (ticked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    })
                  }
                  aria-label={`Add ${r.note || cat?.name || 'entry'}`}
                  className="size-4.5 shrink-0 accent-(--app-primary)"
                />
              )}
              <CategoryTile category={cat} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.note || cat?.name || 'Monthly entry'}</span>
                <span className="block truncate text-xs text-muted">
                  {shortDate(date)}
                  {r.note && cat ? ` · ${cat.name}` : ''}
                </span>
              </span>
              <span className={`shrink-0 text-sm font-semibold tabular ${r.type === 'income' ? 'text-positive' : ''}`}>
                {r.type === 'income' ? '+' : '−'}
                {money(r.amount)}
              </span>
              {canAdd && (
                <button
                  onClick={() => skip.mutate(r.id)}
                  disabled={skip.isPending}
                  className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-medium text-muted hover:bg-subtle hover:text-ink"
                  aria-label={`Skip ${r.note || cat?.name || 'entry'} this month`}
                >
                  Skip
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canAdd && (
        <div className="space-y-2 p-3">
          <ErrorBanner error={add.error ?? skip.error} />
          <Button className="w-full" disabled={!chosen.length} loading={add.isPending} onClick={() => add.mutate(chosen)}>
            {chosen.length === items.length ? `Add ${chosen.length === 1 ? 'it' : `all ${chosen.length}`}` : `Add ${chosen.length} selected`}
          </Button>
        </div>
      )}
    </Card>
  );
}
