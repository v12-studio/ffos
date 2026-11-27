import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpDown, Download, History, Pencil, PiggyBank } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatMoney, HEAD_GROUP_LABELS, type BudgetDTO, type BudgetLineDTO, type CategoryDTO, type HeadGroup } from '@ffos/shared';
import { MonthSwitcher, PageTitle, useViewedMonth } from '../components/AppShell.tsx';
import { HeadRow, HeadSettingsSheet, HeadSheet, MoveMoneySheet, PayButton } from '../components/BudgetParts.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, PageSkeleton, SectionTitle, StatRow } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, needsAttention, sortByGroup, useBudget, useGroupOrder, useMembers, useSaveGroupOrder, useSavePlan, useUpdateHead } from '../lib/budget.ts';
import { currentMonth, monthLabel } from '../lib/format.ts';

export function BudgetPage() {
  const { book, can } = useCurrentBook();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? currentMonth();
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { month: m }, { replace: true });
  useViewedMonth(month);
  const budget = useBudget(book.id, month);
  const categories = useCategories(book.id);
  const members = useMembers(book.id, book.memberCount > 1);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const memberName = (id: string | null | undefined) => (id ? members.data?.find((m) => m.userId === id)?.name.split(' ')[0] : undefined);
  const [openHead, setOpenHead] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const groupOrder = useGroupOrder();
  const b = budget.data;
  const canPlan = can('budget.manage');
  const canExport = can('book.export');

  // Other screens link here to open a head (?head=) or to cover an overspend (?cover=).
  const headParam = params.get('head');
  const coverParam = params.get('cover');
  useEffect(() => {
    if (!headParam && !coverParam) return;
    if (headParam) setOpenHead(headParam);
    if (coverParam && canPlan) setMoving(coverParam);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('head');
        next.delete('cover');
        return next;
      },
      { replace: true },
    );
  }, [headParam, coverParam]);

  const today = b?.today ?? undefined;
  // A finished month can't be fixed, only learned from: just the heads that went over.
  const finished = month < currentMonth();
  const flagged = (l: BudgetLineDTO) => (finished ? lineStatus(l) === 'over' : needsAttention(l, today));
  const attention = sortByGroup((b?.lines ?? []).filter(flagged), groupOrder);
  const rest = (b?.lines ?? []).filter((l) => !flagged(l));
  const rows = (lines: BudgetLineDTO[], withPay = false) => (
    <Card className="divide-y divide-line overflow-hidden">
      {lines.map((line) => (
        <HeadRow
          key={line.categoryId}
          line={line}
          category={byId.get(line.categoryId)}
          ownerName={memberName(byId.get(line.categoryId)?.memberId)}
          currency={book.currency}
          today={today}
          onOpen={() => setOpenHead(line.categoryId)}
          action={withPay && line.group === 'bills' ? <PayButton line={line} month={month} /> : undefined}
        />
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
          {b.carriedFrom && canPlan && <CarriedBanner budget={b} month={month} />}
          {month < currentMonth() ? <MonthReview budget={b} byId={byId} currency={book.currency} month={month} /> : <PlanSummary budget={b} currency={book.currency} />}

          {(canPlan || canExport) && !arranging && (
            <div className="flex justify-end gap-1">
              {canExport && (
                <button onClick={() => setExporting(true)} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-label font-medium text-accent hover:bg-subtle">
                  <Download className="size-3.5" /> Export
                </button>
              )}
              {canPlan && b.lines.length > 0 && (
                <button onClick={() => setArranging(true)} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-label font-medium text-accent hover:bg-subtle">
                  <ArrowUpDown className="size-3.5" /> Arrange
                </button>
              )}
              {canPlan && (
                <Link to={`/budget/${month}/edit`} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-label font-medium text-accent hover:bg-subtle">
                  <Pencil className="size-3.5" /> Edit plan
                </Link>
              )}
            </div>
          )}

          {arranging ? (
            <ArrangeHeads key={month} budget={b} month={month} byId={byId} onDone={() => setArranging(false)} />
          ) : b.lines.length === 0 ? (
            <Card>
              <EmptyState icon={<PiggyBank className="size-5" />} title="No budget heads yet">
                Edit the plan to split your income into bills, spending and savings.
              </EmptyState>
            </Card>
          ) : (
            <>
              {attention.length > 0 && (
                <section>
                  <SectionTitle>{finished ? 'Went over' : 'Needs attention'}</SectionTitle>
                  {rows(attention)}
                </section>
              )}
              {groupOrder.map((group) => {
                const lines = rest.filter((l) => l.group === group);
                const extra = group === 'savings' ? b.unbudgeted.filter((u) => u.group === 'savings') : [];
                if (!lines.length && !extra.length) return null;
                return (
                  <section key={group}>
                    <SectionTitle action={<span className="text-label text-muted tabular">{groupSummary(group, b, book.currency)}</span>}>
                      {HEAD_GROUP_LABELS[group].name}
                    </SectionTitle>
                    {lines.length > 0 && rows(lines, true)}
                    {extra.length > 0 && (
                      <Card className={`divide-y divide-line overflow-hidden ${lines.length ? 'mt-2' : ''}`}>
                        {extra.map((u) => (
                          <button
                            key={u.categoryId}
                            onClick={() => setOpenHead(u.categoryId)}
                            className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60"
                          >
                            <span className="min-w-0 flex-1 truncate text-body">{byId.get(u.categoryId)?.name ?? 'Unknown'}</span>
                            <span className="shrink-0 text-label font-medium text-positive tabular">{formatMoney(u.spent, book.currency)} put aside</span>
                          </button>
                        ))}
                      </Card>
                    )}
                  </section>
                );
              })}
            </>
          )}

          {b.unbudgeted.some((u) => u.group !== 'savings') && (
            <section>
              <SectionTitle>Spent outside the budget</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {b.unbudgeted
                  .filter((u) => u.group !== 'savings')
                  .map((u) => (
                    <button
                      key={u.categoryId}
                      onClick={() => setOpenHead(u.categoryId)}
                      className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60"
                    >
                      <span className="min-w-0 flex-1 truncate text-body">{byId.get(u.categoryId)?.name ?? 'Unknown'}</span>
                      <span className="shrink-0 text-label font-medium tabular">{formatMoney(u.spent, book.currency)}</span>
                    </button>
                  ))}
              </Card>
              <p className="mt-2 px-0.5 text-label text-muted">These categories have no budget head this month, so they come out of what you save.</p>
            </section>
          )}
        </>
      )}

      <HeadSheet
        month={month}
        categoryId={openHead}
        budget={b}
        onClose={() => setOpenHead(null)}
        onMove={(id) => {
          setOpenHead(null);
          setMoving(id);
        }}
        onSettings={(id) => {
          setOpenHead(null);
          setSettingsFor(id);
        }}
      />
      <MoveMoneySheet month={month} budget={b} categoryId={moving} onClose={() => setMoving(null)} />
      <HeadSettingsSheet categoryId={settingsFor} onClose={() => setSettingsFor(null)} />
      <ExportSheet open={exporting} onClose={() => setExporting(false)} preset={{ what: 'budget', period: 'month', month }} />
    </div>
  );
}

/** The figure beside each group's heading. */
function groupSummary(group: HeadGroup, b: BudgetDTO, currency: string): string {
  const money = (n: number) => formatMoney(n, currency);
  const lines = b.lines.filter((l) => l.group === group);
  const planned = lines.reduce((s, l) => s + l.planned, 0);
  const spent = lines.reduce((s, l) => s + l.spent, 0);
  if (group === 'bills') {
    const paid = lines.filter((l) => lineStatus(l) === 'done' || lineStatus(l) === 'over').length;
    return `${paid} of ${lines.length} paid`;
  }
  if (group === 'savings') return `${money(b.totals.saved)} of ${money(planned)} put aside`;
  const left = lines.reduce((s, l) => s + Math.max(0, l.remaining), 0);
  return spent > planned ? `${money(spent - planned)} over` : `${money(left)} left`;
}

/** A month following an earlier plan: keep it as is, or change it. */
function CarriedBanner({ budget: b, month }: { budget: BudgetDTO; month: string }) {
  const { book } = useCurrentBook();
  const toast = useToast();
  const save = useSavePlan(book.id, month);
  const from = monthLabel(b.carriedFrom!).split(' ')[0];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-subtle/60 px-4 py-3">
      <History className="mt-0.5 size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-label">
          Carried over from <strong className="font-semibold">{from}</strong>. Adjust it if this month is different.
        </p>
        <div className="mt-2 flex gap-2">
          <Link to={`/budget/${month}/edit`} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-label font-medium text-primary-fg hover:bg-primary/90">
            Adjust
          </Link>
          <Button
            variant="secondary"
            className="min-h-9 text-label"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { budget: b, lines: b.lines.map((l) => ({ categoryId: l.categoryId, planned: l.planned })) },
                { onSuccess: () => toast({ message: `${monthLabel(month).split(' ')[0]} plan confirmed`, duration: 2000 }) },
              )
            }
          >
            Looks good
          </Button>
        </div>
        <ErrorBanner error={save.error} />
      </div>
    </div>
  );
}

/** This month or a future one: what you're on track to save, and how the income is split. */
function PlanSummary({ budget: b, currency }: { budget: BudgetDTO; currency: string }) {
  const money = (n: number) => formatMoney(n, currency);
  const t = b.totals;
  const lostToOverspend = t.plannedSavings - t.projectedSavings;
  const shortfall = t.projectedSavings < 0;
  const sum = (group: HeadGroup) => b.lines.filter((l) => l.group === group).reduce((s, l) => s + l.planned, 0);
  const groupOrder = useGroupOrder();

  return (
    <Card className="p-4">
      <p className="text-label font-medium text-muted">{shortfall ? 'Heading for a shortfall of' : 'On track to save'}</p>
      <p className={`text-display font-semibold tracking-tight tabular ${shortfall ? 'text-negative' : 'text-positive'}`}>{money(Math.abs(t.projectedSavings))}</p>
      <p className="mt-0.5 text-label text-muted tabular">
        Of {money(b.income)} income
        {lostToOverspend > 0 && <span className="text-negative"> · {money(lostToOverspend)} lost to overspending</span>}
      </p>

      {t.unallocated < 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-label text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          You've planned {money(-t.unallocated)} more than your income.
        </div>
      )}

      {b.today && b.lines.some((l) => l.group === 'spending') && (
        <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-label tabular">
          Safe to spend today <strong className="font-semibold">{money(b.today.safePerDay)}</strong>
          <span className="text-muted">
            {' '}
            · {money(b.today.spendingLeft)} left for {b.today.daysLeft} day{b.today.daysLeft === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <StatRow
        className="mt-4 border-t border-line pt-3"
        items={groupOrder.map((g) => ({
          label: HEAD_GROUP_LABELS[g].name,
          // Income not given to any head is saved too.
          value: money(sum(g) + (g === 'savings' ? Math.max(0, t.unallocated) : 0)),
        }))}
      />
      <p className="mt-2 text-caption text-muted tabular">
        {t.unallocated > 0 && `Savings includes ${money(t.unallocated)} not given to any head. `}
        {t.incomeReceived > 0 ? `${money(t.incomeReceived)} income recorded so far.` : b.today ? 'No income recorded yet this month.' : ''}
      </p>
    </Card>
  );
}

/** A finished month: what was actually saved against the plan, and where it went over or under. */
function MonthReview({ budget: b, byId, currency, month }: { budget: BudgetDTO; byId: Map<string, CategoryDTO>; currency: string; month: string }) {
  const money = (n: number) => formatMoney(n, currency);
  const t = b.totals;
  // Income as recorded if anyone recorded it; otherwise the plan's figure.
  const income = t.incomeReceived > 0 ? t.incomeReceived : b.income;
  const saved = income - t.spent;
  const outgoing = b.lines.filter((l) => l.group !== 'savings');
  const overs = outgoing.filter((l) => l.remaining < 0).sort((a, b) => a.remaining - b.remaining);
  const unders = outgoing.filter((l) => l.group === 'spending' && l.remaining > 0).sort((a, b) => b.remaining - a.remaining);
  const plannedOut = outgoing.reduce((s, l) => s + l.planned, 0);

  return (
    <Card className="p-4">
      <p className="text-label font-medium text-muted">How {monthLabel(month).split(' ')[0]} went</p>
      <p className={`text-display font-semibold tracking-tight tabular ${saved < 0 ? 'text-negative' : 'text-positive'}`}>
        {saved < 0 ? `Short by ${money(-saved)}` : `Saved ${money(saved)}`}
      </p>
      <p className="mt-0.5 text-label text-muted tabular">
        Planned to save {money(t.plannedSavings)}
        {t.incomeReceived > 0 && t.incomeReceived !== b.income && ` · income ${money(t.incomeReceived)} of ${money(b.income)} expected`}
      </p>
      <StatRow
        className="mt-4 border-t border-line pt-3"
        items={[
          { label: 'Spent', value: `${money(t.spent)}` },
          { label: 'Planned', value: money(plannedOut) },
          { label: 'Put aside', value: money(t.saved) },
        ]}
      />
      {(overs.length > 0 || unders.length > 0) && (
        <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-label tabular">
          {overs.slice(0, 3).map((l) => (
            <p key={l.categoryId} className="flex justify-between gap-2">
              <span className="truncate">{byId.get(l.categoryId)?.name ?? 'Unknown'}</span>
              <span className="shrink-0 text-negative">{money(-l.remaining)} over</span>
            </p>
          ))}
          {unders.slice(0, 2).map((l) => (
            <p key={l.categoryId} className="flex justify-between gap-2">
              <span className="truncate">{byId.get(l.categoryId)?.name ?? 'Unknown'}</span>
              <span className="shrink-0 text-positive">{money(l.remaining)} unused</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

interface ArrangeItem {
  categoryId: string;
  group: HeadGroup;
  planned: number;
}

/**
 * Put the sections (bills, spending, savings) in the order the family thinks of them, move a head to
 * another section, and drag heads within a section. Section order is the book's, for every month;
 * a head's section is its own, for every month; the order of heads is saved to this month's plan.
 */
function ArrangeHeads({ budget: b, month, byId, onDone }: { budget: BudgetDTO; month: string; byId: Map<string, CategoryDTO>; onDone: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const savedSections = useGroupOrder();
  const [sections, setSections] = useState(savedSections);
  const [items, setItems] = useState<ArrangeItem[]>(() =>
    sortByGroup(b.lines, savedSections).map((l) => ({ categoryId: l.categoryId, group: l.group, planned: l.planned })),
  );
  const savePlan = useSavePlan(book.id, month);
  const saveSections = useSaveGroupOrder(book.id);
  const updateHead = useUpdateHead(book.id);

  const nameOf = (id: string) => byId.get(id)?.name ?? 'Unknown';
  const lineGroup = new Map(b.lines.map((l) => [l.categoryId, l.group]));
  const moved = items.filter((i) => lineGroup.get(i.categoryId) !== i.group);
  const sectionsChanged = sections.join() !== savedSections.join();
  // The plan only needs saving when the heads wouldn't already show in this order without it.
  const newGroup = new Map(items.map((i) => [i.categoryId, i.group]));
  const wanted = sortByGroup(items, sections).map((i) => i.categoryId);
  const asIs = sortByGroup(
    b.lines.map((l) => ({ categoryId: l.categoryId, group: newGroup.get(l.categoryId) ?? l.group })),
    sections,
  ).map((l) => l.categoryId);
  const orderChanged = wanted.join() !== asIs.join();
  const changed = moved.length > 0 || sectionsChanged || orderChanged;

  const save = useMutation({
    mutationFn: async () => {
      for (const item of moved) await updateHead.mutateAsync({ id: item.categoryId, group: item.group });
      if (sectionsChanged) await saveSections.mutateAsync(sections);
      if (orderChanged) {
        const ordered = sortByGroup(items, sections);
        await savePlan.mutateAsync({ budget: b, lines: ordered.map((i) => ({ categoryId: i.categoryId, planned: i.planned })) });
      }
    },
    onSuccess: () => {
      toast({ message: 'Order saved', duration: 2000 });
      onDone();
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  // A head moved to another section goes to the end of it.
  const moveTo = (id: string, group: HeadGroup) =>
    setItems((all) => {
      const item = all.find((i) => i.categoryId === id)!;
      return [...all.filter((i) => i.categoryId !== id), { ...item, group }];
    });

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>Section order</SectionTitle>
        <Card className="overflow-hidden">
          <SortableList
            className="divide-y divide-line"
            items={sections}
            keyOf={(g) => g}
            onMove={(from, to) => setSections((s) => moveItem(s, from, to))}
            renderItem={(group, handle) => {
              const count = items.filter((i) => i.group === group).length;
              return (
                <div className="flex min-h-12 items-center gap-2 pr-4 pl-3">
                  <DragHandle handle={handle} label={`${HEAD_GROUP_LABELS[group].name} section`} />
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{HEAD_GROUP_LABELS[group].name}</span>
                  <span className="shrink-0 text-caption text-muted">
                    {count} head{count === 1 ? '' : 's'}
                  </span>
                </div>
              );
            }}
          />
        </Card>
        <p className="mt-2 px-0.5 text-caption text-muted">The Budget tab, the plan and the Add screen list sections in this order, for everyone in the book.</p>
      </section>

      {sections.map((group) => {
        const groupItems = items.filter((i) => i.group === group);
        return (
          <section key={group}>
            <SectionTitle>{HEAD_GROUP_LABELS[group].name}</SectionTitle>
            {groupItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-3 text-label text-muted">No heads here. Pick this section beside a head to move it here.</p>
            ) : (
              <Card className="overflow-hidden">
                <SortableList
                  className="divide-y divide-line"
                  items={groupItems}
                  keyOf={(i) => i.categoryId}
                  onMove={(from, to) => {
                    const reordered = moveItem(groupItems, from, to);
                    setItems((all) => [...all.filter((i) => i.group !== group), ...reordered]);
                  }}
                  renderItem={(item, handle) => {
                    const name = nameOf(item.categoryId);
                    return (
                      <div className="flex min-h-12 items-center gap-2 pr-3 pl-3">
                        <DragHandle handle={handle} label={name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">{name}</span>
                          <span className="block text-caption text-muted tabular">{formatMoney(item.planned, book.currency)}</span>
                        </span>
                        <select
                          value={item.group}
                          onChange={(e) => moveTo(item.categoryId, e.target.value as HeadGroup)}
                          aria-label={`Section for ${name}`}
                          className="min-h-9 shrink-0 rounded-lg border border-line bg-surface px-2 text-label text-ink outline-none focus:border-accent"
                        >
                          {sections.map((g) => (
                            <option key={g} value={g}>
                              {HEAD_GROUP_LABELS[g].name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }}
                />
              </Card>
            )}
          </section>
        );
      })}

      <p className="px-0.5 text-caption text-muted">
        Hold ⠿ and drag to reorder. Moving a head to another section changes how it's tracked in every month (a bill is paid once, spending is drawn
        down, savings count as saved).
      </p>
      <div className="space-y-2">
        <ErrorBanner error={save.error} />
        {conflict && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['book', book.id, 'budget', month] });
              onDone();
            }}
          >
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
    </div>
  );
}

/** First budget for this book: nothing earlier to carry over. */
function NoPlan({ month, spent, currency, canPlan }: { month: string; spent: number; currency: string; canPlan: boolean }) {
  const navigate = useNavigate();

  return (
    <Card>
      <EmptyState icon={<PiggyBank className="size-5" />} title="Plan where your money goes">
        <p className="mx-auto max-w-80">
          Enter the month's income and give it jobs: <strong className="font-medium text-ink">bills</strong> to pay,{' '}
          <strong className="font-medium text-ink">spending</strong> for day-to-day, and <strong className="font-medium text-ink">savings</strong>. The plan
          carries on to the next month by itself, and the app shows what's safe to spend each day.
          {spent > 0 && ` ${formatMoney(spent, currency)} has been spent in ${monthLabel(month).split(' ')[0]} so far.`}
        </p>
        {canPlan ? (
          <div className="mt-5 flex flex-col items-center gap-2">
            <Button onClick={() => navigate(`/budget/${month}/edit`)}>Plan {monthLabel(month).split(' ')[0]}</Button>
          </div>
        ) : (
          <p className="mt-2">Ask an owner, admin or editor to plan it.</p>
        )}
      </EmptyState>
    </Card>
  );
}
