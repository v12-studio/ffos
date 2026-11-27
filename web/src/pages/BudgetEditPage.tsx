import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { formatMoney, HEAD_GROUP_LABELS, isCatchAllCategory, toMinor, type BudgetDTO, type CategoryDTO, type HeadGroup } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { HeadSettingsSheet, monthShort } from '../components/BudgetParts.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, ErrorBanner, inputClass, PageSkeleton, SectionTitle, Sheet } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { sectionIdOf, useBudget, useBudgetSuggestions, useSavePlan, useSections } from '../lib/budget.ts';
import { currencySymbol, currentMonth, minorToInput, monthLabel } from '../lib/format.ts';

interface Row {
  categoryId: string;
  amount: string;
}

export function BudgetEditPage() {
  const { month = currentMonth() } = useParams();
  const { book, can } = useCurrentBook();
  const budget = useBudget(book.id, month);
  const categories = useCategories(book.id);

  if (!can('budget.manage')) return <Navigate to="/budget" replace />;
  if (!budget.data || !categories.data) {
    return (
      <PageSkeleton />
    );
  }
  // Keyed by version so a reload after a conflict starts from the latest plan.
  return <Editor key={`${month}-${budget.data.version}-${budget.data.exists}`} month={month} budget={budget.data} categories={categories.data} />;
}

function Editor({ month, budget, categories }: { month: string; budget: BudgetDTO; categories: CategoryDTO[] }) {
  const { book } = useCurrentBook();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const symbol = currencySymbol(book.currency);
  const [income, setIncome] = useState(minorToInput(budget.income));
  const [rows, setRows] = useState<Row[]>(budget.lines.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(l.planned) })));
  const [adding, setAdding] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const suggestions = useBudgetSuggestions(book.id, month);
  const suggestionFor = new Map((suggestions.data?.byCategory ?? []).map((x) => [x.categoryId, x]));
  const groupOf = (id: string): HeadGroup => byId.get(id)?.group ?? 'spending';
  const sections = useSections();
  // The section a category is listed under in this plan.
  const sectionOf = (id: string) => {
    const cat = byId.get(id);
    return cat ? sectionIdOf(cat, sections) : sections.find((s) => s.kind === 'spending')!.id;
  };

  const incomeMinor = toMinor(income || '0');
  const rowMinor = new Map(rows.map((r) => [r.categoryId, toMinor(r.amount || '0')]));
  const invalid = incomeMinor === null || [...rowMinor.values()].some((m) => m === null);
  const total = (group?: HeadGroup) => rows.filter((r) => !group || groupOf(r.categoryId) === group).reduce((s, r) => s + (rowMinor.get(r.categoryId) ?? 0), 0);
  const allocated = total();
  const unassigned = (incomeMinor ?? 0) - allocated;
  const willSave = (incomeMinor ?? 0) - total('bills') - total('spending');
  const money = (n: number) => formatMoney(n, book.currency);
  // Heads are kept in section order (the book's choice); the order within a section is the family's.
  const ordered = sections.flatMap((sec) => rows.filter((r) => sectionOf(r.categoryId) === sec.id));

  const save = useSavePlan(book.id, month);
  const submit = () =>
    save.mutate(
      { budget, income: incomeMinor ?? 0, lines: ordered.map((r) => ({ categoryId: r.categoryId, planned: rowMinor.get(r.categoryId) ?? 0 })) },
      {
        onSuccess: () => {
          toast({ message: `${monthLabel(month)} budget saved`, duration: 2500 });
          navigate(month === currentMonth() ? '/budget' : `/budget?month=${month}`);
        },
      },
    );
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  // New heads go to the end; the first one's amount is focused so typing can start straight away.
  const addHeads = (ids: string[]) => {
    const fresh = ids.filter((id) => !rows.some((r) => r.categoryId === id));
    setRows((r) => [...r, ...fresh.map((categoryId) => ({ categoryId, amount: minorToInput(suggestionFor.get(categoryId)?.average ?? 0) }))]);
    setFocusId(fresh[0] ?? null);
    setAdding(false);
  };
  const setAmount = (id: string, amount: string) => setRows((r) => r.map((x) => (x.categoryId === id ? { ...x, amount } : x)));

  // A first plan from real numbers: every category spent in lately, at its average.
  const fromHistory = (suggestions.data?.byCategory ?? [])
    .filter((x) => x.average > 0 && byId.get(x.categoryId) && !byId.get(x.categoryId)!.archived)
    .sort((a, b) => b.average - a.average);
  const emptyWithSuggestion = rows.filter((r) => !r.amount && (suggestionFor.get(r.categoryId)?.average ?? 0) > 0);

  return (
    <div className="space-y-5">
      <Link to={month === currentMonth() ? '/budget' : `/budget?month=${month}`} className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-label font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Budget
      </Link>
      <PageTitle>Plan {monthLabel(month)}</PageTitle>

      <Card className="flex items-center gap-3 p-4">
        <label htmlFor="income" className="min-w-0 flex-1 text-body font-medium">
          Expected income
        </label>
        <div className="w-40 shrink-0">
          <AmountInput id="income" symbol={symbol} value={income} onChange={setIncome} invalid={incomeMinor === null} large />
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card className="px-4 py-6 text-center">
          <p className="text-label text-muted">
            Give the income jobs: <strong className="font-medium text-ink">bills</strong> like rent and EMIs, day-to-day{' '}
            <strong className="font-medium text-ink">spending</strong> like milk and fuel, and <strong className="font-medium text-ink">savings</strong>.
            Whatever isn't given a job is saved too.
          </p>
          <div className="mt-4 flex flex-col items-center gap-2">
            {fromHistory.length > 0 && (
              <Button
                onClick={() => {
                  setRows(fromHistory.map((x) => ({ categoryId: x.categoryId, amount: minorToInput(x.average) })));
                  toast({ message: `Added ${fromHistory.length} categories at what you usually spend`, duration: 3000 });
                }}
              >
                <Sparkles className="size-4" /> Start from what you spent
              </Button>
            )}
            <Button variant={fromHistory.length ? 'secondary' : 'primary'} onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Pick categories
            </Button>
          </div>
          {fromHistory.length > 0 && <p className="mt-3 text-caption text-muted">Uses the average of the last three months. You can change every amount.</p>}
        </Card>
      ) : (
        <>
          {emptyWithSuggestion.length > 0 && (
            <button
              onClick={() => setRows((r) => r.map((x) => (!x.amount && suggestionFor.get(x.categoryId) ? { ...x, amount: minorToInput(suggestionFor.get(x.categoryId)!.average) } : x)))}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-label font-medium text-accent hover:bg-subtle"
            >
              <Sparkles className="size-4" /> Fill {emptyWithSuggestion.length} empty categor{emptyWithSuggestion.length === 1 ? 'y' : 'ies'} with the usual amount
            </button>
          )}
          {sections.map((section) => {
            const groupRows = rows.filter((r) => sectionOf(r.categoryId) === section.id);
            const sectionTotal = groupRows.reduce((sum, r) => sum + (rowMinor.get(r.categoryId) ?? 0), 0);
            return (
              <section key={section.id}>
                <SectionTitle action={<span className="text-label text-muted tabular">{money(sectionTotal)}</span>}>
                  {section.name}
                  {groupRows.length > 0 && ` · ${groupRows.length}`}
                </SectionTitle>
                {groupRows.length === 0 ? (
                  <button
                    onClick={() => setAdding(true)}
                    className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-dashed border-line px-4 text-left text-label text-muted hover:bg-subtle"
                  >
                    <Plus className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{HEAD_GROUP_LABELS[section.kind].description}</span>
                  </button>
                ) : (
                  <Card className="overflow-hidden">
                    <SortableList
                      className="divide-y divide-line"
                      items={groupRows}
                      keyOf={(r) => r.categoryId}
                      onMove={(from, to) => {
                        const moved = moveItem(groupRows, from, to);
                        setRows((all) => [...all.filter((r) => sectionOf(r.categoryId) !== section.id), ...moved]);
                      }}
                      renderItem={(row, handle) => {
                        const cat = byId.get(row.categoryId);
                        const hint = suggestionFor.get(row.categoryId);
                        const amountMinor = rowMinor.get(row.categoryId);
                        return (
                          <div className="flex items-center gap-2 py-1.5 pr-2 pl-3">
                            <DragHandle handle={handle} label={cat?.name ?? 'Category'} />
                            <div className="min-w-0 flex-1">
                              <button onClick={() => setSettingsFor(row.categoryId)} className="block max-w-full truncate text-left text-body font-medium hover:underline">
                                {cat?.name ?? 'Unknown'}
                              </button>
                              {hint && (hint.average > 0 || hint.last > 0) && (
                                <button
                                  onClick={() => setAmount(row.categoryId, minorToInput(hint.average))}
                                  disabled={amountMinor === hint.average}
                                  className="block max-w-full truncate text-left text-caption text-muted tabular enabled:hover:text-accent"
                                  title={`Average of the last three months. Last month: ${money(hint.last)}. Tap to use the average.`}
                                >
                                  usually {money(hint.average)}
                                </button>
                              )}
                              {cat?.goal && (
                                <span className="block truncate text-caption text-muted tabular">
                                  Goal {money(cat.goal.target)}
                                  {cat.goal.by && ` by ${monthShort(cat.goal.by)}`}
                                </span>
                              )}
                            </div>
                            <div className="w-28 shrink-0">
                              <AmountInput
                                id={`head-${row.categoryId}`}
                                symbol={symbol}
                                value={row.amount}
                                invalid={amountMinor === null}
                                autoFocus={focusId === row.categoryId}
                                onChange={(amount) => setAmount(row.categoryId, amount)}
                              />
                            </div>
                            <button
                              onClick={() => setRows((r) => r.filter((x) => x.categoryId !== row.categoryId))}
                              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                              aria-label={`Remove ${cat?.name ?? 'category'}`}
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        );
                      }}
                    />
                  </Card>
                )}
              </section>
            );
          })}
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add categories
            </Button>
          </div>
          <p className="px-0.5 text-caption text-muted">
            Tap a category's name to choose its section (bill, spending or savings), set a goal, or make it someone's allowance. Hold ⠿ and drag to reorder. To change the order of the sections, use Arrange on the Budget tab.
          </p>
        </>
      )}

      {/* Running total stays visible while typing amounts. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-safe lg:left-60">
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-3 lg:max-w-3xl lg:px-8">
          <ErrorBanner error={save.error} />
          {conflict && (
            <Button variant="secondary" className="w-full" onClick={() => queryClient.invalidateQueries({ queryKey: ['book', book.id, 'budget', month] })}>
              Reload latest plan
            </Button>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-label leading-snug">
              <p className="truncate text-muted tabular">
                {unassigned < 0 ? `${money(-unassigned)} more than income` : `${money(unassigned)} not given a job`}
              </p>
              <p className={`font-semibold tabular ${willSave < 0 ? 'text-negative' : 'text-positive'}`}>
                {willSave < 0 ? `${money(-willSave)} short` : `${money(willSave)} will be saved`}
              </p>
            </div>
            <Button className="shrink-0" disabled={invalid || conflict} loading={save.isPending} onClick={submit}>
              Save plan
            </Button>
          </div>
        </div>
      </div>

      <AddHeadSheet open={adding} onClose={() => setAdding(false)} used={new Set(rows.map((r) => r.categoryId))} onAdd={addHeads} month={month} />
      <HeadSettingsSheet categoryId={settingsFor} onClose={() => setSettingsFor(null)} />
    </div>
  );
}

function AmountInput({
  id,
  symbol,
  value,
  onChange,
  invalid,
  large,
  autoFocus,
}: {
  id: string;
  symbol: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  large?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted ${large ? 'text-title' : ''}`}>{symbol}</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="0"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className={`${inputClass} pl-8 text-right tabular ${large ? 'min-h-12 text-title font-semibold' : ''}`}
      />
    </div>
  );
}

/** Pick several heads at once from a searchable checklist, or name a new one. */
function AddHeadSheet({
  open,
  onClose,
  used,
  onAdd,
  month,
}: {
  open: boolean;
  onClose: () => void;
  used: Set<string>;
  onAdd: (categoryIds: string[]) => void;
  month: string;
}) {
  const { book } = useCurrentBook();
  const suggestions = useBudgetSuggestions(book.id, month, open);
  const averageOf = new Map((suggestions.data?.byCategory ?? []).map((x) => [x.categoryId, x.average]));
  const queryClient = useQueryClient();
  const categories = useCategories(book.id);
  const sections = useSections();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setQuery('');
      setPicked([]);
    }
  }, [open]);

  const available = useMemo(
    () =>
      (categories.data ?? [])
        .filter((c) => c.kind === 'expense' && !c.archived && !used.has(c.id))
        .sort((a, b) => Number(isCatchAllCategory(a)) - Number(isCatchAllCategory(b)) || (averageOf.get(b.id) ?? 0) - (averageOf.get(a.id) ?? 0)),
    [categories.data, used, suggestions.data],
  );
  const text = query.trim();
  const shown = available.filter((c) => c.name.toLowerCase().includes(text.toLowerCase()));
  const exactMatch = available.some((c) => c.name.toLowerCase() === text.toLowerCase()) || [...used].some((id) => categories.data?.find((c) => c.id === id)?.name.toLowerCase() === text.toLowerCase());
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // Creates the head as an expense category (or reuses one with the same name) and ticks it.
  const create = useMutation({
    mutationFn: () => api.post<CategoryDTO>(`/books/${book.id}/categories`, { name: text, kind: 'expense' }),
    onSuccess: (created) => {
      queryClient.setQueryData<CategoryDTO[]>(['book', book.id, 'categories'], (list = []) =>
        list.some((c) => c.id === created.id) ? list : [...list, created],
      );
      setPicked((p) => (p.includes(created.id) ? p : [...p, created.id]));
      setQuery('');
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to the budget"
      footer={
        <Button className="w-full" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
          {picked.length === 0 ? 'Tick the categories to add' : `Add ${picked.length} categor${picked.length === 1 ? 'y' : 'ies'}`}
        </Button>
      }
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text && !exactMatch) create.mutate();
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, or type a new category"
            aria-label="Search or name a new category"
            maxLength={40}
            autoComplete="off"
            className={`${inputClass} pl-10`}
          />
        </div>
        {text && !exactMatch && (
          <Button type="submit" variant="secondary" className="w-full" loading={create.isPending}>
            <Plus className="size-4" /> Create “{text}”
          </Button>
        )}
        <ErrorBanner error={create.error} />
      </form>

      {shown.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          {shown.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-subtle"
              >
                <CategoryTile category={c} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate text-caption text-muted tabular">
                    {sections.find((sec) => sec.id === sectionIdOf(c, sections))?.name}
                    {averageOf.get(c.id) ? ` · usually ${formatMoney(averageOf.get(c.id)!, book.currency)}` : ''}
                  </span>
                </span>
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-md border ${on ? 'border-primary bg-primary text-primary-fg' : 'border-line'}`}
                  aria-hidden
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        !text && <p className="py-6 text-center text-label text-muted">Every category is already in the plan. Type a name to create a new one.</p>
      )}
    </Sheet>
  );
}
