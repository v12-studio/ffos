import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { formatMoney, isCatchAllCategory, toMinor, type BudgetDTO, type CategoryDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, ErrorBanner, inputClass, SectionTitle, Sheet, Spinner } from '../components/ui.tsx';
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
      <div className="grid h-60 place-items-center text-muted">
        <Spinner />
      </div>
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

  const addHead = (categoryId: string) => {
    setRows((r) => (r.some((x) => x.categoryId === categoryId) ? r : [...r, { categoryId, amount: '' }]));
    setFocusId(categoryId);
    setAdding(false);
  };

  return (
    <div className="space-y-6 pb-24">
      <Link to={month === currentMonth() ? '/budget' : `/budget?month=${month}`} className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Budget
      </Link>
      <PageTitle subtitle="Split the month's income into budget heads. Anything left over is saved.">Plan {monthLabel(month)}</PageTitle>

      <section>
        <SectionTitle>Income</SectionTitle>
        <Card className="p-4">
          <label htmlFor="income" className="mb-1.5 block text-sm font-medium">
            Expected income this month
          </label>
          <AmountInput id="income" symbol={symbol} value={income} onChange={setIncome} invalid={incomeMinor === null} large />
        </Card>
      </section>

      <section>
        <SectionTitle>Budget heads</SectionTitle>
        <Card className="divide-y divide-line">
          {rows.length === 0 && <p className="px-4 py-5 text-center text-sm text-muted">Add heads like Food, Bills or Medical and give each a limit.</p>}
          {rows.map((row, i) => {
            const cat = byId.get(row.categoryId);
            return (
              <div key={row.categoryId} className="flex items-center gap-3 px-4 py-2.5">
                <CategoryTile category={cat} size="sm" />
                <label htmlFor={`head-${row.categoryId}`} className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {cat?.name ?? 'Unknown'}
                </label>
                <div className="w-36 shrink-0">
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
                  className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                  aria-label={`Remove ${cat?.name ?? 'head'}`}
                >
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
          <button onClick={() => setAdding(true)} className="flex min-h-12 w-full items-center justify-center gap-2 text-sm font-medium text-accent hover:bg-subtle/60">
            <Plus className="size-4" /> Add budget head
          </button>
        </Card>
      </section>

      {/* Running total stays visible while typing amounts. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 backdrop-blur-md lg:bottom-0 lg:left-60">
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-3 lg:max-w-3xl lg:px-8">
          <ErrorBanner error={save.error} />
          {conflict && (
            <Button variant="secondary" className="w-full" onClick={() => queryClient.invalidateQueries({ queryKey: ['book', book.id, 'budget', month] })}>
              Reload latest plan
            </Button>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
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

      <AddHeadSheet open={adding} onClose={() => setAdding(false)} used={new Set(rows.map((r) => r.categoryId))} onPick={addHead} />
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
      <span className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted ${large ? 'text-lg' : ''}`}>{symbol}</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="0"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className={`${inputClass} pl-8 text-right tabular ${large ? 'min-h-12 text-xl font-semibold' : ''}`}
      />
    </div>
  );
}

function AddHeadSheet({
  open,
  onClose,
  used,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  used: Set<string>;
  onPick: (categoryId: string) => void;
}) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const categories = useCategories(book.id);
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const available = useMemo(
    () =>
      (categories.data ?? [])
        .filter((c) => c.kind === 'expense' && !used.has(c.id))
        .sort((a, b) => Number(isCatchAllCategory(a)) - Number(isCatchAllCategory(b))),
    [categories.data, used],
  );

  // Creates the head as an expense category (or reuses one with the same name).
  const create = useMutation({
    mutationFn: () => api.post<CategoryDTO>(`/books/${book.id}/categories`, { name: name.trim(), kind: 'expense' }),
    onSuccess: (created) => {
      queryClient.setQueryData<CategoryDTO[]>(['book', book.id, 'categories'], (list = []) =>
        list.some((c) => c.id === created.id) ? list : [...list, created],
      );
      onPick(created.id);
    },
  });

  return (
    <Sheet open={open} onClose={onClose} title="Add budget head">
      <form
        className="mb-5 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label htmlFor="new-head" className="block text-sm font-medium">
          New head
        </label>
        <div className="flex gap-2">
          <input
            id="new-head"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fruits, Milk, School fees"
            maxLength={40}
            autoComplete="off"
            className={`${inputClass} min-w-0`}
          />
          <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
            Add
          </Button>
        </div>
        <ErrorBanner error={create.error} />
      </form>

      {available.length > 0 && (
        <>
          <p className="mb-2 text-sm font-medium">Or pick an existing category</p>
          <div className="flex flex-wrap gap-2">
            {available.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-sm hover:bg-subtle"
              >
                <CategoryTile category={c} size="sm" />
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
