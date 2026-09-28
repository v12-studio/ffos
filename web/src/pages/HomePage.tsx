import { useQuery } from '@tanstack/react-query';
import { ChevronRight, PiggyBank, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type SummaryDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useOpenTransaction } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, SectionTitle, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, statusBar, useBudget, usedPct } from '../lib/budget.ts';
import { currentMonth, monthLabel } from '../lib/format.ts';

export function HomePage() {
  const { book, can } = useCurrentBook();
  const openTransaction = useOpenTransaction();
  const [month, setMonth] = useState(currentMonth);
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
    <div className="space-y-6">
      <PageTitle action={<MonthSwitcher month={month} onChange={setMonth} />}>Overview</PageTitle>
      <ErrorBanner error={summary.error} />

      {!s ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : (
        <>
          <SummaryCard income={s.income} expense={s.expense} net={s.net} money={money} />
          <BudgetSnapshot month={month} />

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
            <div className="grid gap-6 lg:grid-cols-2">
              {s.byCategory.length > 0 && (
                <section>
                  <SectionTitle>Spending by category</SectionTitle>
                  <Card className="divide-y divide-line">
                    {s.byCategory.slice(0, 6).map((row) => {
                      const cat = byId.get(row.categoryId);
                      const pct = s.expense ? (row.total / s.expense) * 100 : 0;
                      return (
                        <div key={row.categoryId} className="flex items-center gap-3 px-4 py-3">
                          <CategoryTile category={cat} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="truncate font-medium">{cat?.name ?? 'Unknown'}</span>
                              <span className="shrink-0 tabular">
                                {money(row.total)}
                                <span className="ml-1.5 inline-block w-9 text-right text-muted">{Math.round(pct)}%</span>
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: cat?.color ?? '#64748b' }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                </section>
              )}

              <section>
                <SectionTitle
                  action={
                    <Link to="/transactions" className="text-[13px] font-medium text-accent">
                      View all
                    </Link>
                  }
                >
                  Recent transactions
                </SectionTitle>
                <Card className="divide-y divide-line overflow-hidden">
                  {s.recent.map((t) => (
                    <TransactionRow key={t.id} txn={t} category={byId.get(t.categoryId)} currency={book.currency} showDate />
                  ))}
                </Card>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ income, expense, net, money }: { income: number; expense: number; net: number; money: (n: number) => string }) {
  const total = income + expense;
  const incomePct = total ? (income / total) * 100 : 50;
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-muted">Net cash flow</p>
      <p className={`mt-1 text-[32px] leading-tight font-semibold tracking-tight tabular ${net < 0 ? 'text-negative' : ''}`}>
        {net < 0 ? '−' : ''}
        {money(Math.abs(net))}
      </p>

      <div className="mt-5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
        {total > 0 && (
          <>
            <div className="bg-positive" style={{ width: `${incomePct}%` }} />
            <div className="flex-1 bg-negative/80" />
          </>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="flex items-center gap-1.5 text-[13px] text-muted">
            <span className="size-2 rounded-full bg-positive" /> Income
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular">{money(income)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[13px] text-muted">
            <span className="size-2 rounded-full bg-negative/80" /> Expenses
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular">{money(expense)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** Budget at a glance: savings on track, and the heads closest to (or over) their limit. */
function BudgetSnapshot({ month }: { month: string }) {
  const { book, can } = useCurrentBook();
  const budget = useBudget(book.id, month);
  const categories = useCategories(book.id);
  const b = budget.data;
  if (!b) return null;
  const href = month === currentMonth() ? '/budget' : `/budget?month=${month}`;
  const money = (n: number) => formatMoney(n, book.currency);

  if (!b.exists) {
    if (!can('budget.manage')) return null;
    return (
      <Link to={`/budget/${month}/edit`} className="block">
        <Card className="flex items-center gap-3 p-4 hover:bg-subtle/60">
          <PiggyBank className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Plan {monthLabel(month).split(' ')[0]}'s budget</span>
            <span className="block text-[13px] text-muted">Split your income into heads and see what you save.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" />
        </Card>
      </Link>
    );
  }

  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const watch = [...b.lines]
    .filter((l) => l.planned > 0 || l.spent > 0)
    .sort((x, y) => usedPct(y) - usedPct(x) || y.spent - x.spent)
    .slice(0, 3);
  const savings = b.totals.projectedSavings;

  return (
    <Link to={href} className="block">
      <Card className="p-4 hover:bg-subtle/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-muted">Budget · {monthLabel(month).split(' ')[0]}</p>
          <ChevronRight className="size-4 text-muted" />
        </div>
        <p className="mt-1 text-sm">
          {savings >= 0 ? 'On track to save ' : 'Heading for a shortfall of '}
          <strong className={`font-semibold tabular ${savings < 0 ? 'text-negative' : 'text-positive'}`}>{money(Math.abs(savings))}</strong>
        </p>
        {watch.length > 0 && (
          <div className="mt-3 space-y-2.5">
            {watch.map((l) => {
              const status = lineStatus(l);
              return (
                <div key={l.categoryId}>
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span className="truncate">{byId.get(l.categoryId)?.name ?? 'Unknown'}</span>
                    <span className={`shrink-0 tabular ${status === 'over' ? 'text-negative' : 'text-muted'}`}>
                      {l.remaining < 0 ? `${money(-l.remaining)} over` : `${money(l.remaining)} left`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
                    <div className={`h-full rounded-full ${statusBar[status]}`} style={{ width: `${usedPct(l)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </Link>
  );
}
