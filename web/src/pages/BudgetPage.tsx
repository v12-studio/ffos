import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, PiggyBank, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatMoney, type BudgetDTO, type CategoryDTO, type TransactionDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, SectionTitle, Sheet, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, statusBar, statusText, useBudget, usedPct } from '../lib/budget.ts';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.ts';

export function BudgetPage() {
  const { book, can } = useCurrentBook();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { month: m }, { replace: true });
  const budget = useBudget(book.id, month);
  const categories = useCategories(book.id);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const [openHead, setOpenHead] = useState<string | null>(null);
  const b = budget.data;

  return (
    <div className="space-y-6">
      <PageTitle action={<MonthSwitcher month={month} onChange={setMonth} />}>Budget</PageTitle>
      <ErrorBanner error={budget.error} />

      {!b ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : !b.exists ? (
        <NoPlan month={month} spent={b.totals.spent} currency={book.currency} canPlan={can('budget.manage')} />
      ) : (
        <>
          <PlanSummary budget={b} currency={book.currency} month={month} canPlan={can('budget.manage')} />

          <section>
            <SectionTitle>Budget heads</SectionTitle>
            {b.lines.length === 0 ? (
              <Card>
                <EmptyState icon={<PiggyBank className="size-5" />} title="No budget heads yet">
                  Edit the plan to split your income into heads like Food or Bills.
                </EmptyState>
              </Card>
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {b.lines.map((line) => {
                  const cat = byId.get(line.categoryId);
                  const status = lineStatus(line);
                  return (
                    <button
                      key={line.categoryId}
                      onClick={() => setOpenHead(line.categoryId)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle/60 active:bg-subtle"
                    >
                      <CategoryTile category={cat} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-medium">{cat?.name ?? 'Unknown'}</span>
                          <span className={`shrink-0 text-sm font-medium tabular ${status === 'over' ? 'text-negative' : ''}`}>
                            {line.remaining < 0
                              ? `${formatMoney(-line.remaining, book.currency)} over`
                              : `${formatMoney(line.remaining, book.currency)} left`}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                          <div className={`h-full rounded-full ${statusBar[status]}`} style={{ width: `${usedPct(line)}%` }} />
                        </div>
                        <p className={`mt-1 text-xs tabular ${statusText[status]}`}>
                          {formatMoney(line.spent, book.currency)} of {formatMoney(line.planned, book.currency)}
                          {status === 'near' && ' · nearly used up'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </Card>
            )}
          </section>

          {b.unbudgeted.length > 0 && (
            <section>
              <SectionTitle>Spent outside the budget</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {b.unbudgeted.map((u) => {
                  const cat = byId.get(u.categoryId);
                  return (
                    <button
                      key={u.categoryId}
                      onClick={() => setOpenHead(u.categoryId)}
                      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60"
                    >
                      <CategoryTile category={cat} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{cat?.name ?? 'Unknown'}</span>
                      <span className="shrink-0 text-sm font-medium tabular">{formatMoney(u.spent, book.currency)}</span>
                    </button>
                  );
                })}
              </Card>
              <p className="mt-2 px-0.5 text-[13px] text-muted">These categories have no budget head this month. Add them to the plan to track them.</p>
            </section>
          )}
        </>
      )}

      <HeadTransactionsSheet
        month={month}
        categoryId={openHead}
        category={openHead ? byId.get(openHead) : undefined}
        budget={b}
        onClose={() => setOpenHead(null)}
      />
    </div>
  );
}

function PlanSummary({ budget: b, currency, month, canPlan }: { budget: BudgetDTO; currency: string; month: string; canPlan: boolean }) {
  const navigate = useNavigate();
  const money = (n: number) => formatMoney(n, currency);
  const t = b.totals;
  const lostToOverspend = t.plannedSavings - t.projectedSavings;
  const budgetSpent = b.lines.reduce((s, l) => s + l.spent, 0);
  const spentPct = t.allocated ? Math.min(100, (budgetSpent / t.allocated) * 100) : 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">Saved this month</p>
          <p className={`mt-1 text-[32px] leading-tight font-semibold tracking-tight tabular ${t.projectedSavings < 0 ? 'text-negative' : 'text-positive'}`}>
            {t.projectedSavings < 0 ? '−' : ''}
            {money(Math.abs(t.projectedSavings))}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {lostToOverspend > 0
              ? `Planned ${money(t.plannedSavings)} · ${money(lostToOverspend)} lost to overspending`
              : `As planned, if you stay within budget`}
          </p>
        </div>
        {canPlan && (
          <Button variant="secondary" className="min-h-9! shrink-0 px-3 text-sm" onClick={() => navigate(`/budget/${month}/edit`)}>
            <Pencil className="size-3.5" /> Edit plan
          </Button>
        )}
      </div>

      {t.plannedSavings < 0 && (
        <div className="mt-4 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          You've planned {money(-t.plannedSavings)} more than your income.
        </div>
      )}

      <div className="mt-5">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">Spent</span>
          <span className="tabular">
            <span className="font-semibold">{money(budgetSpent)}</span> <span className="text-muted">of {money(t.allocated)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-subtle">
          <div className={`h-full rounded-full ${budgetSpent > t.allocated ? 'bg-negative' : 'bg-primary'}`} style={{ width: `${spentPct}%` }} />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-[13px]">
        <div>
          <dt className="text-muted">Income</dt>
          <dd className="mt-0.5 font-semibold tabular">{money(b.income)}</dd>
        </div>
        <div>
          <dt className="text-muted">Budgeted</dt>
          <dd className="mt-0.5 font-semibold tabular">{money(t.allocated)}</dd>
        </div>
        <div>
          <dt className="text-muted">Left to spend</dt>
          <dd className="mt-0.5 font-semibold tabular">{money(Math.max(0, t.allocated - budgetSpent))}</dd>
        </div>
      </dl>
      {t.incomeReceived > 0 && t.incomeReceived !== b.income && (
        <p className="mt-3 text-xs text-muted">Income recorded so far: {money(t.incomeReceived)}</p>
      )}
    </Card>
  );
}

function NoPlan({ month, spent, currency, canPlan }: { month: string; spent: number; currency: string; canPlan: boolean }) {
  const { book } = useCurrentBook();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const previous = shiftMonth(month, -1);
  const copy = useMutation({
    mutationFn: () => api.post<BudgetDTO>(`/books/${book.id}/budget/${month}/copy`, { from: previous }),
    onSuccess: (data) => {
      queryClient.setQueryData(['book', book.id, 'budget', month], data);
      toast({ message: `Copied ${monthLabel(previous)}'s plan`, duration: 2500 });
    },
  });

  return (
    <Card>
      <EmptyState icon={<PiggyBank className="size-5" />} title={`No plan for ${monthLabel(month)} yet`}>
        <p className="mx-auto max-w-72">
          Split this month's income into budget heads. Whatever you don't allocate is shown as saved.
          {spent > 0 && ` ${formatMoney(spent, currency)} has been spent so far.`}
        </p>
        {canPlan ? (
          <div className="mt-5 flex flex-col items-center gap-2">
            <Button onClick={() => navigate(`/budget/${month}/edit`)}>Plan {monthLabel(month).split(' ')[0]}</Button>
            <Button variant="ghost" loading={copy.isPending} onClick={() => copy.mutate()}>
              <Copy className="size-4" /> Copy {monthLabel(previous).split(' ')[0]}'s plan
            </Button>
            {copy.error && (
              <p className="text-sm text-negative">{copy.error instanceof ApiError ? copy.error.message : 'Could not copy'}</p>
            )}
          </div>
        ) : (
          <p className="mt-2">Ask an owner, admin or editor to plan it.</p>
        )}
      </EmptyState>
    </Card>
  );
}

/** Tap a head to see what was spent in it this month. */
function HeadTransactionsSheet({
  month,
  categoryId,
  category,
  budget,
  onClose,
}: {
  month: string;
  categoryId: string | null;
  category?: CategoryDTO;
  budget?: BudgetDTO;
  onClose: () => void;
}) {
  const { book } = useCurrentBook();
  const txns = useQuery({
    queryKey: ['book', book.id, 'transactions', month],
    queryFn: () => api.get<TransactionDTO[]>(`/books/${book.id}/transactions?month=${month}`),
    enabled: categoryId !== null,
  });
  if (!categoryId) return null;
  const rows = (txns.data ?? []).filter((t) => t.categoryId === categoryId && t.type === 'expense');
  const line = budget?.lines.find((l) => l.categoryId === categoryId);

  return (
    <Sheet open onClose={onClose} title={category?.name ?? 'Budget head'}>
      {line && (
        <p className={`mb-4 text-sm tabular ${statusText[lineStatus(line)]}`}>
          {formatMoney(line.spent, book.currency)} of {formatMoney(line.planned, book.currency)} ·{' '}
          {line.remaining < 0
            ? `${formatMoney(-line.remaining, book.currency)} over budget`
            : `${formatMoney(line.remaining, book.currency)} left`}
        </p>
      )}
      {txns.isLoading ? (
        <div className="grid h-24 place-items-center text-muted">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing spent here in {monthLabel(month)}.</p>
      ) : (
        <div className="-mx-5 divide-y divide-line border-y border-line">
          {rows.map((t) => (
            <TransactionRow key={t.id} txn={t} category={category} currency={book.currency} showDate />
          ))}
        </div>
      )}
    </Sheet>
  );
}
