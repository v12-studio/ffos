import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { formatMoney, isCatchAllCategory, toMinor, type BudgetDTO, type CategoryDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, ErrorBanner, inputClass, PageSkeleton, SectionTitle, Sheet } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { useBudget } from '../lib/budget.ts';
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
  const [focusId, setFocusId] = useState<string | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const incomeMinor = toMinor(income || '0');
  const rowMinor = rows.map((r) => toMinor(r.amount || '0'));
  const invalid = incomeMinor === null || rowMinor.some((m) => m === null);
  const allocated = rowMinor.reduce<number>((s, m) => s + (m ?? 0), 0);
  const left = (incomeMinor ?? 0) - allocated;
  const money = (n: number) => formatMoney(n, book.currency);

  const save = useMutation({
    mutationFn: () =>
      api.put<BudgetDTO>(`/books/${book.id}/budget/${month}`, {
        income: incomeMinor ?? 0,
        lines: rows.map((r, i) => ({ categoryId: r.categoryId, planned: rowMinor[i] ?? 0 })),
        ...(budget.exists ? { version: budget.version } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['book', book.id, 'budget', month], data);
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'activity'] });
      toast({ message: `${monthLabel(month)} budget saved`, duration: 2500 });
      navigate(month === currentMonth() ? '/budget' : `/budget?month=${month}`);
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  // New heads go to the end; the first one's amount is focused so typing can start straight away.
  const addHeads = (ids: string[]) => {
    const fresh = ids.filter((id) => !rows.some((r) => r.categoryId === id));
    setRows((r) => [...r, ...fresh.map((categoryId) => ({ categoryId, amount: '' }))]);
    setFocusId(fresh[0] ?? null);
    setAdding(false);
  };

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

      <section>
        <SectionTitle
          action={
            rows.length > 0 && (
              <button onClick={() => setAdding(true)} className="flex min-h-6 items-center gap-1 text-label font-medium text-accent">
                <Plus className="size-3.5" /> Add heads
              </button>
            )
          }
        >
          Budget heads{rows.length > 0 && ` · ${rows.length}`}
        </SectionTitle>
        {rows.length === 0 ? (
          <Card className="px-4 py-6 text-center">
            <p className="text-label text-muted">Split the income into heads like Milk, Rent or School fees. Whatever isn't planned is saved.</p>
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add budget heads
            </Button>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden">
              <SortableList
                className="divide-y divide-line"
                items={rows}
                keyOf={(r) => r.categoryId}
                onMove={(from, to) => setRows((r) => moveItem(r, from, to))}
                renderItem={(row, handle) => {
                  const cat = byId.get(row.categoryId);
                  const i = rows.indexOf(row);
                  return (
                    <div className="flex items-center gap-2 py-1.5 pr-2 pl-3">
                      <DragHandle handle={handle} label={cat?.name ?? 'Head'} />
                      <label htmlFor={`head-${row.categoryId}`} className="min-w-0 flex-1 truncate text-body font-medium">
                        {cat?.name ?? 'Unknown'}
                      </label>
                      <div className="w-28 shrink-0">
                        <AmountInput
                          id={`head-${row.categoryId}`}
                          symbol={symbol}
                          value={row.amount}
                          invalid={rowMinor[i] === null}
                          autoFocus={focusId === row.categoryId}
                          onChange={(amount) => setRows((r) => r.map((x) => (x.categoryId === row.categoryId ? { ...x, amount } : x)))}
                        />
                      </div>
                      <button
                        onClick={() => setRows((r) => r.filter((x) => x.categoryId !== row.categoryId))}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                        aria-label={`Remove ${cat?.name ?? 'head'}`}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  );
                }}
              />
            </Card>
            <p className="mt-2 px-0.5 text-caption text-muted">Hold ⠿ and drag to change the order. The Add screen lists heads in this order.</p>
          </>
        )}
      </section>

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
              <p className="text-muted tabular">
                Budgeted {money(allocated)} of {money(incomeMinor ?? 0)}
              </p>
              <p className={`font-semibold tabular ${left < 0 ? 'text-negative' : 'text-positive'}`}>
                {left < 0 ? `${money(-left)} more than income` : `${money(left)} will be saved`}
              </p>
            </div>
            <Button className="shrink-0" disabled={invalid || conflict} loading={save.isPending} onClick={() => save.mutate()}>
              Save plan
            </Button>
          </div>
        </div>
      </div>

      <AddHeadSheet open={adding} onClose={() => setAdding(false)} used={new Set(rows.map((r) => r.categoryId))} onAdd={addHeads} />
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
}: {
  open: boolean;
  onClose: () => void;
  used: Set<string>;
  onAdd: (categoryIds: string[]) => void;
}) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const categories = useCategories(book.id);
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
        .sort((a, b) => Number(isCatchAllCategory(a)) - Number(isCatchAllCategory(b))),
    [categories.data, used],
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
      title="Add budget heads"
      footer={
        <Button className="w-full" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
          {picked.length === 0 ? 'Tick the heads to add' : `Add ${picked.length} head${picked.length === 1 ? '' : 's'}`}
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
            placeholder="Search, or type a new head"
            aria-label="Search or name a new head"
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
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
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
        !text && <p className="py-6 text-center text-label text-muted">Every category is already in the plan. Type a name to create a new head.</p>
      )}
    </Sheet>
  );
}
