import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, PiggyBank, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type BudgetDTO, type CategoryDTO, type SummaryDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useOpenTransaction, useViewedMonth } from '../components/AppShell.tsx';
import { tileColor } from '../components/CategoryIcon.tsx';
import { RecurringDueCard } from '../components/RecurringDue.tsx';
import { TrendsCard } from '../components/TrendsCard.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, EmptyState, ErrorBanner, PageSkeleton, SectionTitle } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, useBudget } from '../lib/budget.ts';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.ts';

export function HomePage() {
  const { book, can } = useCurrentBook();
  const openTransaction = useOpenTransaction();
  const [month, setMonth] = useState(currentMonth);
  useViewedMonth(month);
  const categories = useCategories(book.id);
  const summary = useQuery({
    queryKey: ['book', book.id, 'summary', month],
    queryFn: () => api.get<SummaryDTO>(`/books/${book.id}/summary?month=${month}`),
    refetchInterval: 60_000,
  });
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const s = summary.data;
  const money = (n: number) => formatMoney(n, book.currency);

  return (
    <div className="space-y-5">
      <PageTitle tab action={<MonthSwitcher month={month} onChange={setMonth} />}>
        Overview
      </PageTitle>
      <ErrorBanner error={summary.error} />

      {!s ? (
        <PageSkeleton />
      ) : (
        <>
          <SummaryCard summary={s} month={month} money={money} />
          {month === currentMonth() && <RecurringDueCard month={month} />}

          {s.count === 0 ? (
            <Card>
              <EmptyState icon={<ReceiptText className="size-5" />} title="No transactions this month">
                {can('txn.create') ? (
                  <Button className="mt-4" onClick={() => openTransaction()}>
                    Add a transaction
                  </Button>
                ) : (
                  'Entries added by members will appear here.'
                )}
              </EmptyState>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section>
                <SectionTitle
                  action={
                    <Link to="/transactions" className="text-label font-medium text-accent">
                      View all
                    </Link>
                  }
                >
                  Recent
                </SectionTitle>
                <Card className="divide-y divide-line overflow-hidden">
                  {s.recent.map((t) => (
                    <TransactionRow key={t.id} txn={t} category={byId.get(t.categoryId)} currency={book.currency} showDate />
                  ))}
                </Card>
              </section>

              {s.byCategory.length > 0 && <SpendingCard summary={s} byId={byId} month={month} money={money} />}
            </div>
          )}

          <TrendsCard month={month} onSelect={setMonth} />
        </>
      )}
    </div>
  );
}

/** The month in one card: what's left, what came in and went out, and how the budget is doing. */
function SummaryCard({ summary: s, month, money }: { summary: SummaryDTO; month: string; money: (n: number) => string }) {
  const thisMonth = month === currentMonth();
  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <p className="text-label font-medium text-muted">{thisMonth ? 'Left this month' : `${month < currentMonth() ? 'Left over' : 'Left'} in ${monthLabel(month).split(' ')[0]}`}</p>
        <p className={`text-display font-semibold tracking-tight tabular ${s.net < 0 ? 'text-negative' : ''}`}>
          {s.net < 0 ? '−' : ''}
          {money(Math.abs(s.net))}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 text-label text-muted tabular">
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-positive" />
            In <span className="font-semibold text-ink">{money(s.income)}</span>
          </span>
          <span>
            <span className="mr-1.5 inline-block size-2 rounded-full bg-negative/80" />
            Spent <span className="font-semibold text-ink">{money(s.expense)}</span>
          </span>
        </p>
      </div>
      <BudgetLine month={month} money={money} />
    </Card>
  );
}

/** One tappable line under the summary: savings on track and how many heads are over. */
function BudgetLine({ month, money }: { month: string; money: (n: number) => string }) {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const budget = useBudget(book.id, month);
  const b = budget.data;
  const canPlan = can('budget.manage');
  const previous = shiftMonth(month, -1);
  // Only needed to offer copying last month's plan, so only fetched when this month has none.
  const previousBudget = useBudget(book.id, previous, canPlan && b?.exists === false);
  const copy = useMutation({
    mutationFn: () => api.post<BudgetDTO>(`/books/${book.id}/budget/${month}/copy`, { from: previous }),
    onSuccess: (data) => {
      queryClient.setQueryData(['book', book.id, 'budget', month], data);
      toast({ message: `Copied ${monthLabel(previous).split(' ')[0]}'s plan to ${monthLabel(month).split(' ')[0]}`, duration: 2500 });
    },
  });
  if (!b) return null;
  const monthName = monthLabel(month).split(' ')[0];
  const rowClass = 'flex min-h-12 items-center gap-3 border-t border-line px-4 py-2.5 text-label hover:bg-subtle/60';

  if (!b.exists) {
    if (!canPlan) return null;
    const canCopy = previousBudget.data?.exists === true && previousBudget.data.lines.length > 0;
    return (
      <div className="border-t border-line px-4 py-3">
        <p className="flex items-center gap-2 text-label font-medium">
          <PiggyBank className="size-4 shrink-0 text-muted" /> No budget for {monthName} yet
        </p>
        <div className="mt-2.5 flex gap-2">
          {canCopy && (
            <Button className="min-h-10 flex-1 text-label" loading={copy.isPending} onClick={() => copy.mutate()}>
              Copy {monthLabel(previous).split(' ')[0]}'s plan
            </Button>
          )}
          <Link
            to={`/budget/${month}/edit`}
            className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-label font-medium ${
              canCopy ? 'border border-line bg-surface text-ink hover:bg-subtle' : 'flex-1 bg-primary text-primary-fg hover:bg-primary/90'
            }`}
          >
            {canCopy ? 'Start fresh' : `Plan ${monthName}`}
          </Link>
        </div>
        {copy.error && <p className="mt-2 text-label text-negative">{copy.error instanceof ApiError ? copy.error.message : 'Could not copy'}</p>}
      </div>
    );
  }

  const savings = b.totals.projectedSavings;
  const finished = month < currentMonth();
  const over = b.lines.filter((l) => lineStatus(l) === 'over').length;
  return (
    <Link to={month === currentMonth() ? '/budget' : `/budget?month=${month}`} className={rowClass}>
      <PiggyBank className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        {savings >= 0 ? (finished ? 'Saved ' : 'On track to save ') : finished ? 'Short by ' : 'Heading for a shortfall of '}
        <strong className={`font-semibold tabular ${savings < 0 ? 'text-negative' : 'text-positive'}`}>{money(Math.abs(savings))}</strong>
        {over > 0 && <span className="text-negative"> · {over} over budget</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

/** Where the money went: one bar split by category, then one line per category. */
function SpendingCard({
  summary: s,
  byId,
  month,
  money,
}: {
  summary: SummaryDTO;
  byId: Map<string, CategoryDTO>;
  month: string;
  money: (n: number) => string;
}) {
  const rows = s.byCategory.slice(0, 5);
  const shown = rows.reduce((sum, r) => sum + r.total, 0);
  const rest = s.expense - shown;
  const monthParam = month === currentMonth() ? '' : `&month=${month}`;
  return (
    <section>
      <SectionTitle>Where it went</SectionTitle>
      <Card className="overflow-hidden">
        <div className="flex h-2 gap-0.5 px-4 pt-4 pb-0" aria-hidden>
          {rows.map((r) => (
            <div
              key={r.categoryId}
              className="h-2 rounded-full"
              style={{ width: `${(r.total / s.expense) * 100}%`, backgroundColor: tileColor(byId.get(r.categoryId)) }}
            />
          ))}
          {rest > 0 && <div className="h-2 flex-1 rounded-full bg-subtle" />}
        </div>
        <div className="mt-4 divide-y divide-line border-t border-line">
          {rows.map((r) => {
            const cat = byId.get(r.categoryId);
            return (
              <Link
                key={r.categoryId}
                to={`/transactions?category=${r.categoryId}${monthParam}`}
                className="flex min-h-11 items-center gap-3 px-4 text-label hover:bg-subtle/60"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tileColor(cat) }} />
                <span className="min-w-0 flex-1 truncate font-medium">{cat?.name ?? 'Unknown'}</span>
                <span className="shrink-0 font-semibold tabular">{money(r.total)}</span>
                <span className="w-9 shrink-0 text-right text-muted tabular">{s.expense ? Math.round((r.total / s.expense) * 100) : 0}%</span>
              </Link>
            );
          })}
          {rest > 0 && (
            <Link to={`/transactions?${monthParam.slice(1)}`} className="flex min-h-11 items-center gap-3 px-4 text-label text-muted hover:bg-subtle/60">
              <span className="size-2.5 shrink-0 rounded-full bg-subtle ring-1 ring-line" />
              <span className="flex-1">Everything else</span>
              <span className="shrink-0 tabular">{money(rest)}</span>
              <span className="w-9 shrink-0 text-right tabular">{Math.round((rest / s.expense) * 100)}%</span>
            </Link>
          )}
        </div>
      </Card>
    </section>
  );
}
