import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpDown, Copy, PiggyBank, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatMoney, type BudgetDTO, type BudgetLineDTO, type CategoryDTO, type TransactionDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useOpenTransaction, useViewedMonth } from '../components/AppShell.tsx';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, PageSkeleton, ProgressBar, SectionTitle, Sheet, Spinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, statusBar, statusText, useBudget, usedPct } from '../lib/budget.ts';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.ts';

export function BudgetPage() {
  const { book, can } = useCurrentBook();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { month: m }, { replace: true });
  useViewedMonth(month);
  const budget = useBudget(book.id, month);
  const categories = useCategories(book.id);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const [openHead, setOpenHead] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const b = budget.data;
  const canPlan = can('budget.manage');
  // Heads over, or close to, their limit come first; the rest stay in plan order.
  // A head spent exactly to its plan (rent, fees) is done, not a worry, so it stays in the main list.
  const needsAttention = (l: BudgetLineDTO) => lineStatus(l) === 'over' || (lineStatus(l) === 'near' && !fullyUsed(l));
  const attention = (b?.lines ?? []).filter(needsAttention);
  const onTrack = (b?.lines ?? []).filter((l) => !needsAttention(l));
  const headRows = (lines: BudgetLineDTO[]) => (
    <Card className="divide-y divide-line overflow-hidden">
      {lines.map((line) => (
        <HeadRow key={line.categoryId} line={line} category={byId.get(line.categoryId)} currency={book.currency} onOpen={() => setOpenHead(line.categoryId)} />
      ))}
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageTitle tab action={<MonthSwitcher month={month} onChange={setMonth} />}>
        Budget
      </PageTitle>
      <ErrorBanner error={budget.error} />

      {!b ? (
        <PageSkeleton />
      ) : !b.exists ? (
        <NoPlan month={month} spent={b.totals.spent} currency={book.currency} canPlan={canPlan} />
      ) : (
        <>
          <PlanSummary budget={b} currency={book.currency} month={month} />

          {arranging ? (
            <ArrangeHeads key={month} budget={b} month={month} byId={byId} onDone={() => setArranging(false)} />
          ) : (
          <>
          {attention.length > 0 && (
            <section>
              <SectionTitle>Needs attention</SectionTitle>
              {headRows(attention)}
            </section>
          )}

          {(onTrack.length > 0 || attention.length === 0) && (
            <section>
              <SectionTitle
                action={
                  canPlan && (
                    <span className="flex items-center gap-4">
                      {b.lines.length > 1 && (
                        <button onClick={() => setArranging(true)} className="flex min-h-6 items-center gap-1 text-label font-medium text-accent">
                          <ArrowUpDown className="size-3.5" /> Arrange
                        </button>
                      )}
                      <Link to={`/budget/${month}/edit`} className="flex min-h-6 items-center gap-1 text-label font-medium text-accent">
                        <Pencil className="size-3.5" /> Edit plan
                      </Link>
                    </span>
                  )
                }
              >
                Budget heads
              </SectionTitle>
              {b.lines.length === 0 ? (
                <Card>
                  <EmptyState icon={<PiggyBank className="size-5" />} title="No budget heads yet">
                    Edit the plan to split your income into heads like Food or Bills.
                  </EmptyState>
                </Card>
              ) : (
                headRows(onTrack)
              )}
            </section>
          )}

          {/* Every head needs attention, so the section holding Edit plan isn't shown. */}
          {onTrack.length === 0 && attention.length > 0 && canPlan && (
            <div className="flex justify-center gap-2">
              {b.lines.length > 1 && (
                <button onClick={() => setArranging(true)} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-label font-medium text-accent hover:bg-subtle">
                  <ArrowUpDown className="size-3.5" /> Arrange
                </button>
              )}
              <Link to={`/budget/${month}/edit`} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-label font-medium text-accent hover:bg-subtle">
                <Pencil className="size-3.5" /> Edit plan
              </Link>
            </div>
          )}
          </>
          )}

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
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60"
                    >
                      <span className="min-w-0 flex-1 truncate text-body">{cat?.name ?? 'Unknown'}</span>
                      <span className="shrink-0 text-label font-medium tabular">{formatMoney(u.spent, book.currency)}</span>
                    </button>
                  );
                })}
              </Card>
              <p className="mt-2 px-0.5 text-label text-muted">These categories have no budget head this month. Add them to the plan to track them.</p>
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

/** Drag heads into the order the family thinks of them; saved straight to this month's plan. */
function ArrangeHeads({ budget: b, month, byId, onDone }: { budget: BudgetDTO; month: string; byId: Map<string, CategoryDTO>; onDone: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [order, setOrder] = useState(b.lines);
  const changed = order.some((l, i) => l.categoryId !== b.lines[i]?.categoryId);
  const save = useMutation({
    mutationFn: () =>
      api.put<BudgetDTO>(`/books/${book.id}/budget/${month}`, {
        income: b.income,
        lines: order.map((l) => ({ categoryId: l.categoryId, planned: l.planned })),
        version: b.version,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['book', book.id, 'budget', month], data);
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'activity'] });
      toast({ message: 'Order saved', duration: 2000 });
      onDone();
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  return (
    <section>
      <SectionTitle>Arrange budget heads</SectionTitle>
      <Card className="overflow-hidden">
        <SortableList
          className="divide-y divide-line"
          items={order}
          keyOf={(l) => l.categoryId}
          onMove={(from, to) => setOrder((o) => moveItem(o, from, to))}
          renderItem={(line, handle) => {
            const name = byId.get(line.categoryId)?.name ?? 'Unknown';
            return (
              <div className="flex min-h-12 items-center gap-2 pr-4 pl-3">
                <DragHandle handle={handle} label={name} />
                <span className="min-w-0 flex-1 truncate text-body font-medium">{name}</span>
                <span className="shrink-0 text-label text-muted tabular">{formatMoney(line.planned, book.currency)}</span>
              </div>
            );
          }}
        />
      </Card>
      <p className="mt-2 px-0.5 text-caption text-muted">Hold ⠿ and drag. The Add screen lists heads in this order.</p>
      <div className="mt-3 space-y-2">
        <ErrorBanner error={save.error} />
        {conflict && (
          <Button variant="secondary" className="w-full" onClick={() => { queryClient.invalidateQueries({ queryKey: ['book', book.id, 'budget', month] }); onDone(); }}>
            Reload latest plan
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onDone}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!changed || conflict} loading={save.isPending} onClick={() => save.mutate()}>
            Save order
          </Button>
        </div>
      </div>
    </section>
  );
}

const fullyUsed = (l: Pick<BudgetLineDTO, 'planned' | 'spent'>) => l.planned > 0 && l.spent === l.planned;

/** Two short lines per head: name and what's left, then the bar and the plan. */
function HeadRow({ line, category, currency, onOpen }: { line: BudgetLineDTO; category?: CategoryDTO; currency: string; onOpen: () => void }) {
  const done = fullyUsed(line);
  const status = done ? 'ok' : lineStatus(line);
  return (
    <button onClick={onOpen} className="block w-full px-4 py-2 text-left hover:bg-subtle/60 active:bg-subtle">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-body font-medium">{category?.name ?? 'Unknown'}</span>
        <span className={`shrink-0 text-label font-semibold tabular ${status === 'over' ? 'text-negative' : done ? 'text-muted' : ''}`}>
          {done ? 'Fully used' : line.remaining < 0 ? `${formatMoney(-line.remaining, currency)} over` : `${formatMoney(line.remaining, currency)} left`}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-2">
        <ProgressBar className="h-1.5 flex-1" pct={usedPct(line)} tone={done ? 'bg-muted/40' : statusBar[status]} />
        <span className={`w-20 shrink-0 text-right text-caption tabular ${statusText[status]}`}>of {formatMoney(line.planned, currency)}</span>
      </span>
    </button>
  );
}

function PlanSummary({ budget: b, currency, month }: { budget: BudgetDTO; currency: string; month: string }) {
  const money = (n: number) => formatMoney(n, currency);
  const t = b.totals;
  const lostToOverspend = t.plannedSavings - t.projectedSavings;
  const budgetSpent = b.lines.reduce((s, l) => s + l.spent, 0);
  const spentPct = t.allocated ? Math.min(100, (budgetSpent / t.allocated) * 100) : 0;
  const finished = month < currentMonth();
  const shortfall = t.projectedSavings < 0;
  const heading = finished ? (shortfall ? 'Shortfall' : 'Saved') : shortfall ? 'Heading for a shortfall of' : 'On track to save';
  const leftToSpend = t.allocated - budgetSpent;

  return (
    <Card className="p-4">
      <p className="text-label font-medium text-muted">{heading}</p>
      <p className={`text-display font-semibold tracking-tight tabular ${shortfall ? 'text-negative' : 'text-positive'}`}>{money(Math.abs(t.projectedSavings))}</p>
      <p className="mt-0.5 text-label text-muted tabular">
        Of {money(b.income)} income
        {lostToOverspend > 0 && <span className="text-negative"> · {money(lostToOverspend)} lost to overspending</span>}
      </p>

      {t.plannedSavings < 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-label text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          You've planned {money(-t.plannedSavings)} more than your income.
        </div>
      )}

      <ProgressBar className="mt-4 h-2" pct={spentPct} tone={budgetSpent > t.allocated ? 'bg-negative' : 'bg-primary'} />
      <div className="mt-1.5 flex justify-between gap-2 text-label tabular">
        <span className="text-muted">
          Spent <span className="font-semibold text-ink">{money(budgetSpent)}</span> of {money(t.allocated)}
        </span>
        <span className={leftToSpend < 0 ? 'font-semibold text-negative' : 'font-semibold'}>
          {leftToSpend < 0 ? `${money(-leftToSpend)} over` : `${money(leftToSpend)} left`}
        </span>
      </div>
      {t.incomeReceived > 0 && t.incomeReceived !== b.income && (
        <p className="mt-2 text-caption text-muted">Income recorded so far: {money(t.incomeReceived)}</p>
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
  const previousBudget = useBudget(book.id, previous, canPlan);
  const canCopy = previousBudget.data?.exists === true && previousBudget.data.lines.length > 0;
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
            {canCopy && (
              <Button variant="ghost" loading={copy.isPending} onClick={() => copy.mutate()}>
                <Copy className="size-4" /> Copy {monthLabel(previous).split(' ')[0]}'s plan
              </Button>
            )}
            {copy.error && (
              <p className="text-label text-negative">{copy.error instanceof ApiError ? copy.error.message : 'Could not copy'}</p>
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
  const { book, can } = useCurrentBook();
  const openTransaction = useOpenTransaction();
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
        <p className={`mb-4 text-label tabular ${statusText[lineStatus(line)]}`}>
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
        <p className="py-6 text-center text-label text-muted">Nothing spent here in {monthLabel(month)}.</p>
      ) : (
        <div className="-mx-5 divide-y divide-line border-y border-line">
          {rows.map((t) => (
            <TransactionRow key={t.id} txn={t} category={category} currency={book.currency} showDate />
          ))}
        </div>
      )}
      {can('txn.create') && (
        <Button
          className="mt-4 w-full"
          onClick={() => {
            onClose();
            openTransaction(undefined, { categoryId });
          }}
        >
          <Plus className="size-4" /> Add expense to {category?.name ?? 'this head'}
        </Button>
      )}
      <Link
        to={`/transactions?category=${categoryId}&scope=all`}
        className="mt-2 flex min-h-11 items-center justify-center rounded-lg text-label font-medium text-accent hover:bg-subtle"
      >
        See {category?.name ?? 'this category'} in every month
      </Link>
    </Sheet>
  );
}
