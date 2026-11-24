import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, PiggyBank, ReceiptText, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMoney, type BudgetDTO, type BudgetLineDTO, type CategoryDTO, type SummaryDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle, TransactionRow, useOpenTransaction, useViewedMonth } from '../components/AppShell.tsx';
import { HeadRow, PayButton, SafeToSpend } from '../components/BudgetParts.tsx';
import { tileColor } from '../components/CategoryIcon.tsx';
import { RecurringDueCard, useRecurringDue } from '../components/RecurringDue.tsx';
import { TrendsCard, useTrends } from '../components/TrendsCard.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, PageSkeleton, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, needsAttention, useBudget } from '../lib/budget.ts';
import { currentMonth, monthLabel, shiftMonth, todayISO } from '../lib/format.ts';

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
  const budget = useBudget(book.id, month);
  // The cards below only mount once summary and budget arrive; subscribing here sends their requests in
  // the same round trip instead of one after another.
  useTrends(book.id, month);
  useRecurringDue(book.id, month, month === currentMonth());
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const s = summary.data;
  const b = budget.data;
  const money = (n: number) => formatMoney(n, book.currency);
  // With a plan, the Overview is about the budget; without one, it's the month's money in and out.
  const planned = b?.exists === true && b.lines.length > 0;

  return (
    <div className="space-y-5">
      <PageTitle tab action={<MonthSwitcher month={month} onChange={setMonth} />}>
        Overview
      </PageTitle>
      <ErrorBanner error={summary.error ?? budget.error} />

      {!s || !b ? (
        <PageSkeleton />
      ) : (
        <>
          {planned ? (
            <BudgetOverview budget={b} month={month} byId={byId} />
          ) : (
            <SummaryCard summary={s} month={month} money={money} budget={b} />
          )}
          {month === currentMonth() && (
            <RecurringDueCard
              month={month}
              hideCategoryIds={planned ? new Set(b.lines.filter((l) => l.group === 'bills' && l.due).map((l) => l.categoryId)) : undefined}
            />
          )}

          {s.count === 0 ? (
            !planned && (
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
            )
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

              {!planned && s.byCategory.length > 0 && <SpendingCard summary={s} byId={byId} month={month} money={money} />}
            </div>
          )}

          <TrendsCard month={month} onSelect={setMonth} />
        </>
      )}
    </div>
  );
}

/** The budget at a glance: safe to spend today, what needs attention, bills to pay, savings. */
function BudgetOverview({ budget: b, month, byId }: { budget: BudgetDTO; month: string; byId: Map<string, CategoryDTO> }) {
  const { book } = useCurrentBook();
  const { user } = useAuth();
  const navigate = useNavigate();
  const money = (n: number) => formatMoney(n, book.currency);
  const today = b.today ?? undefined;
  const budgetLink = (extra = '') => {
    const q = new URLSearchParams(extra);
    if (month !== currentMonth()) q.set('month', month);
    const qs = q.toString();
    return `/budget${qs ? `?${qs}` : ''}`;
  };
  const open = (line: BudgetLineDTO) => navigate(budgetLink(`head=${line.categoryId}`));
  const row = (line: BudgetLineDTO, action?: ReactNode) => (
    <HeadRow key={line.categoryId} line={line} category={byId.get(line.categoryId)} currency={book.currency} today={today} onOpen={() => open(line)} action={action} />
  );

  const attention = b.lines.filter((l) => needsAttention(l, today));
  const mine = b.lines.filter((l) => user && byId.get(l.categoryId)?.memberId === user.id && !attention.includes(l));
  const bills = b.lines.filter((l) => l.group === 'bills');
  const unpaid = bills
    .filter((l) => lineStatus(l) === 'ok')
    .sort((x, y) => (x.due?.date ?? '9999').localeCompare(y.due?.date ?? '9999'));
  const savings = b.lines.filter((l) => l.group === 'savings');
  const savingsPlanned = savings.reduce((sum, l) => sum + l.planned, 0);
  const goals = savings.filter((l) => l.goal);
  const t = b.totals;
  const finished = month < currentMonth();
  const over = b.lines.filter((l) => lineStatus(l) === 'over').length;
  const savedSoFar = (t.incomeReceived > 0 ? t.incomeReceived : b.income) - t.spent;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="p-4">
          {today && b.lines.some((l) => l.group === 'spending') ? (
            <SafeToSpend budget={b} currency={book.currency} />
          ) : finished ? (
            <>
              <p className="text-label font-medium text-muted">Saved in {monthLabel(month).split(' ')[0]}</p>
              <p className={`text-display font-semibold tracking-tight tabular ${savedSoFar < 0 ? 'text-negative' : 'text-positive'}`}>
                {savedSoFar < 0 ? '−' : ''}
                {money(Math.abs(savedSoFar))}
              </p>
              <p className="mt-0.5 text-label text-muted tabular">Planned {money(t.plannedSavings)}</p>
            </>
          ) : (
            <>
              <p className="text-label font-medium text-muted">Planned for {monthLabel(month).split(' ')[0]}</p>
              <p className="text-display font-semibold tracking-tight tabular">{money(t.allocated)}</p>
              <p className="mt-0.5 text-label text-muted tabular">Of {money(b.income)} income</p>
            </>
          )}
        </div>
        {!finished && (
          <Link to={budgetLink()} className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2.5 text-label hover:bg-subtle/60">
            <PiggyBank className="size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              {t.projectedSavings >= 0 ? 'On track to save ' : 'Heading for a shortfall of '}
              <strong className={`font-semibold tabular ${t.projectedSavings < 0 ? 'text-negative' : 'text-positive'}`}>{money(Math.abs(t.projectedSavings))}</strong>
              {over > 0 && <span className="text-negative"> · {over} over budget</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" />
          </Link>
        )}
      </Card>

      {month === currentMonth() && <LastMonthReview month={month} />}

      {attention.length > 0 && (
        <section>
          <SectionTitle
            action={
              <Link to={budgetLink()} className="text-label font-medium text-accent">
                Budget
              </Link>
            }
          >
            Needs attention
          </SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{attention.slice(0, 4).map((l) => row(l))}</Card>
          {attention.length > 4 && <p className="mt-2 px-0.5 text-label text-muted">and {attention.length - 4} more on the Budget tab.</p>}
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <SectionTitle>Your allowance</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{mine.map((l) => row(l))}</Card>
        </section>
      )}

      {bills.length > 0 && !finished && (
        <section>
          <SectionTitle action={<span className="text-label text-muted">{bills.length - unpaid.length} of {bills.length} paid</span>}>Bills</SectionTitle>
          {unpaid.length === 0 ? (
            <Card className="flex min-h-12 items-center gap-2 px-4 text-label">
              <CircleCheck className="size-4 text-positive" /> All bills paid for {monthLabel(month).split(' ')[0]}
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {unpaid.slice(0, 4).map((l) => row(l, <PayButton line={l} month={month} />))}
            </Card>
          )}
          {unpaid.length > 0 && unpaid.some((l) => l.due && l.due.date <= todayISO()) && (
            <p className="mt-2 px-0.5 text-label text-warning">Some bills are due. Mark them paid once they're done.</p>
          )}
        </section>
      )}

      {(savingsPlanned > 0 || t.saved > 0) && (
        <section>
          <SectionTitle>Savings</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            <Link to={budgetLink()} className="flex min-h-12 items-center gap-3 px-4 text-label hover:bg-subtle/60">
              <span className="min-w-0 flex-1">
                Put aside <strong className="font-semibold text-positive tabular">{money(t.saved)}</strong>
                {savingsPlanned > 0 && <span className="text-muted tabular"> of {money(savingsPlanned)} planned</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
            {goals.map((l) => row(l))}
          </Card>
        </section>
      )}
    </>
  );
}

/** First week of a month: how last month went, until dismissed. */
function LastMonthReview({ month }: { month: string }) {
  const { book } = useCurrentBook();
  const previous = shiftMonth(month, -1);
  const key = `ffos.review.${book.id}.${previous}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const early = Number(todayISO().slice(8, 10)) <= 7;
  const prev = useBudget(book.id, previous, early && !dismissed);
  const p = prev.data;
  if (!early || dismissed || !p?.exists || !p.saved) return null;
  const money = (n: number) => formatMoney(n, book.currency);
  const income = p.totals.incomeReceived > 0 ? p.totals.incomeReceived : p.income;
  const saved = income - p.totals.spent;
  const over = p.lines.filter((l) => l.group !== 'savings' && l.remaining < 0).length;
  const name = monthLabel(previous).split(' ')[0];
  return (
    <Card className="flex items-center gap-1 overflow-hidden">
      <Link to={`/budget?month=${previous}`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-label hover:bg-subtle/60">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">How {name} went</span>
          <span className="block text-muted tabular">
            {saved >= 0 ? `Saved ${money(saved)}` : `Short by ${money(-saved)}`} of {money(p.totals.plannedSavings)} planned
            {over > 0 && ` · ${over} head${over === 1 ? '' : 's'} over`}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" />
      </Link>
      <button
        onClick={() => {
          try {
            localStorage.setItem(key, '1');
          } catch {
            // Private mode: it just shows again next time.
          }
          setDismissed(true);
        }}
        className="mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle"
        aria-label={`Dismiss ${name} review`}
      >
        <X className="size-4" />
      </button>
    </Card>
  );
}

/** No plan yet: the month's money in and out, and an invitation to plan it. */
function SummaryCard({ summary: s, month, money, budget }: { summary: SummaryDTO; month: string; money: (n: number) => string; budget: BudgetDTO }) {
  const { can } = useCurrentBook();
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
      {can('budget.manage') && (
        <Link
          to={budget.exists ? (month === currentMonth() ? '/budget' : `/budget?month=${month}`) : `/budget/${month}/edit`}
          className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2.5 text-label hover:bg-subtle/60"
        >
          <PiggyBank className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Plan {monthLabel(month).split(' ')[0]}'s budget</span>
            <span className="block text-muted">Split income into bills, spending and savings, and see what's safe to spend each day.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" />
        </Link>
      )}
    </Card>
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
