import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, CopyPlus, Delete, Repeat, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  canModifyRecord,
  formatMoney,
  isCatchAllCategory,
  toMinor,
  type BudgetLineDTO,
  type CategoryDTO,
  type TransactionDTO,
} from '@ffos/shared';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { lineStatus, statusText, useBudget } from '../lib/budget.ts';
import { monthLabel, todayISO } from '../lib/format.ts';
import { enqueue, isNetworkError, newClientId } from '../lib/offline.ts';
import { recentCategoryIds, rememberCategory } from '../lib/recent.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { CategoryGlyph, CategoryTile } from './CategoryIcon.tsx';
import { useToast } from './Toast.tsx';
import { Button, ErrorBanner, inputClass, Segmented, Sheet } from './ui.tsx';

export function useCategories(bookId: string) {
  return useQuery({
    queryKey: ['book', bookId, 'categories'],
    queryFn: async () => {
      const list = await api.get<CategoryDTO[]>(`/books/${bookId}/categories`);
      saveSnapshot(`categories.${bookId}`, list);
      return list;
    },
    staleTime: 5 * 60_000,
    // Offline start: the last-known categories, so entries can still be recorded.
    initialData: () => loadSnapshot<CategoryDTO[]>(`categories.${bookId}`),
    initialDataUpdatedAt: 0,
  });
}

// How many categories the quick-pick strip shows; the rest are under "All".
const STRIP_SIZE = 12;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

function applyKey(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
  if (/\.\d{2}$/.test(current)) return current; // max two decimals
  if (current === '0') return key;
  if (current.replace('.', '').length >= 10) return current;
  return current + key;
}

export function TransactionSheet({
  open,
  onClose,
  transaction: initial,
}: {
  open: boolean;
  onClose: () => void;
  transaction?: TransactionDTO | null;
}) {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useCategories(book.id);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [repeat, setRepeat] = useState(false);
  // "Add again" turns an open transaction into a new one with the same details.
  const [asNew, setAsNew] = useState(false);
  const [clientId, setClientId] = useState(newClientId);
  // The full category list replaces the form inside the sheet.
  const [view, setView] = useState<'form' | 'categories'>('form');
  const [categorySearch, setCategorySearch] = useState('');
  const transaction = asNew ? null : initial;

  // Adds a named category to the book so it shows up for future transactions, then selects it.
  const addCategory = useMutation({
    mutationFn: () => api.post<CategoryDTO>(`/books/${book.id}/categories`, { name: newCategory.trim(), kind: type }),
    onSuccess: (created) => {
      queryClient.setQueryData<CategoryDTO[]>(['book', book.id, 'categories'], (list = []) =>
        list.some((c) => c.id === created.id) ? list : [...list, created],
      );
      setCategoryId(created.id);
      setNewCategory('');
      setView('form');
    },
  });

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setType(initial?.type ?? 'expense');
    setAmount(initial ? String(initial.amount / 100) : '');
    setDate(initial?.date ?? todayISO());
    setCategoryId(initial?.categoryId ?? '');
    setNote(initial?.note ?? '');
    setNewCategory('');
    setRepeat(false);
    setAsNew(false);
    setView('form');
    setCategorySearch('');
    setClientId(newClientId());
    addCategory.reset();
    save.reset();
    remove.reset();
  }, [open, initial]);

  // Physical keyboard support for desktop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9.]$/.test(e.key)) setAmount((a) => applyKey(a, e.key));
      else if (e.key === 'Backspace') setAmount((a) => applyKey(a, 'back'));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['book', book.id] });

  const newBody = () => ({ type, amount: toMinor(amount) ?? 0, date, categoryId, note, clientId, ...(repeat ? { repeatMonthly: true } : {}) });
  const save = useMutation({
    mutationFn: () => {
      const body = { type, amount: toMinor(amount) ?? 0, date, categoryId, note };
      return transaction
        ? api.patch<TransactionDTO>(`/books/${book.id}/transactions/${transaction.id}`, { ...body, version: transaction.version })
        : api.post<TransactionDTO>(`/books/${book.id}/transactions`, newBody());
    },
    // Run even when the browser says it's offline (React Query would otherwise pause the save
    // indefinitely), so it fails fast and lands in the offline queue below.
    networkMode: 'always',
    // No connection: keep a new entry on this device and send it when the connection returns.
    onError: (err) => {
      if (transaction || !isNetworkError(err)) return;
      enqueue({ bookId: book.id, body: newBody() });
      rememberCategory(book.id, categoryId);
      onClose();
      toast({ message: "You're offline. Saved on this device; it will sync when you're back online.", duration: 5000 });
    },
    onSuccess: () => {
      rememberCategory(book.id, categoryId);
      invalidate();
      onClose();
      if (type === 'expense' && budgetCheck?.inBudget && budgetCheck.leftAfter < 0) {
        toast({ message: `${budgetCheck.name} is ${formatMoney(-budgetCheck.leftAfter, book.currency)} over budget` });
      }
    },
  });

  // No confirm dialog: deleting is instant and reversible from the toast or Recently deleted.
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/books/${book.id}/transactions/${id}`),
    onSuccess: (_, id) => {
      invalidate();
      onClose();
      toast({
        message: 'Transaction deleted',
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.post(`/books/${book.id}/transactions/${id}/restore`);
              toast({ message: 'Transaction restored', duration: 2500 });
            } catch (err) {
              toast({ message: err instanceof Error ? err.message : "Couldn't restore. Try Recently deleted." });
            }
            invalidate();
          },
        },
      });
    },
  });

  const isEdit = Boolean(transaction);
  const canSave = isEdit
    ? canModifyRecord(book.role, 'update', transaction!.createdBy, user!.id)
    : can('txn.create');
  const canDelete = isEdit && canModifyRecord(book.role, 'delete', transaction!.createdBy, user!.id);
  const minor = toMinor(amount) ?? 0;
  const budgetMonth = date.slice(0, 7);
  const budget = useBudget(book.id, budgetMonth, open && type === 'expense');
  const recent = useMemo(() => (open ? recentCategoryIds(book.id) : []), [open, book.id]);
  // This month's budget heads first (in plan order), then the ones this person used most
  // recently, then the rest in the book's order, "Other" last.
  const headOrder = new Map((budget.data?.lines ?? []).map((l, i) => [l.categoryId, i]));
  const rank = (c: CategoryDTO) => {
    if (headOrder.has(c.id)) return headOrder.get(c.id)!;
    if (isCatchAllCategory(c)) return 10_000;
    const r = recent.indexOf(c.id);
    return r >= 0 ? 1_000 + r : 2_000;
  };
  // Hidden categories aren't offered, except the one an existing entry already uses.
  const options = (categories.data ?? [])
    .filter((c) => c.kind === type && (!c.archived || c.id === categoryId))
    .sort((a, b) => rank(a) - rank(b));
  // With a budget for the month, budget heads get their own group so they're easy to tell apart.
  const budgetLines = type === 'expense' && budget.data?.exists ? budget.data.lines : [];
  const lineById = new Map(budgetLines.map((l) => [l.categoryId, l]));
  const budgetOptions = options.filter((c) => lineById.has(c.id));
  const otherOptions = options.filter((c) => !lineById.has(c.id));
  const selectedCategory = options.find((c) => c.id === categoryId);
  const offerNewCategory = canSave && can('txn.create') && selectedCategory !== undefined && isCatchAllCategory(selectedCategory);
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  // Quick picks: what this person used last, then the order above. The selected one always shows.
  const recentRank = (c: CategoryDTO) => {
    const r = recent.indexOf(c.id);
    return r >= 0 ? r : recent.length;
  };
  let strip = [...options].sort((a, b) => recentRank(a) - recentRank(b)).slice(0, STRIP_SIZE);
  if (selectedCategory && !strip.includes(selectedCategory)) strip = [selectedCategory, ...strip.slice(0, -1)];
  const searchText = categorySearch.trim().toLowerCase();
  const matchesSearch = (c: CategoryDTO) => c.name.toLowerCase().includes(searchText);
  const categoryGroups: [string, CategoryDTO[]][] = (
    budgetOptions.length > 0
      ? ([
          [`In your ${monthLabel(budgetMonth)} budget`, budgetOptions.filter(matchesSearch)],
          ['Not in budget', otherOptions.filter(matchesSearch)],
        ] as [string, CategoryDTO[]][])
      : ([['', options.filter(matchesSearch)]] as [string, CategoryDTO[]][])
  ).filter(([, list]) => list.length > 0);
  const pickFromList = (c: CategoryDTO) => {
    setCategoryId(c.id);
    // Choosing the catch-all stays here to offer naming a new category.
    if (!(canSave && can('txn.create') && isCatchAllCategory(c))) setView('form');
  };

  // Budget head for the chosen category in the transaction's month. Over-budget entries are
  // allowed; the sheet only warns.
  const budgetCheck = useMemo(() => {
    if (!budget.data?.exists || !categoryId) return null;
    const line = budget.data.lines.find((l) => l.categoryId === categoryId);
    const name = selectedCategory?.name ?? 'This category';
    if (!line) return { name, inBudget: false as const, monthName: monthLabel(budgetMonth) };
    // When editing, the saved amount is already counted in `spent`; don't count it twice.
    const alreadyCounted =
      transaction && transaction.type === 'expense' && transaction.categoryId === categoryId && transaction.date.slice(0, 7) === budgetMonth
        ? transaction.amount
        : 0;
    const leftBefore = line.planned - (line.spent - alreadyCounted);
    return { name, inBudget: true as const, planned: line.planned, leftBefore, leftAfter: leftBefore - minor };
  }, [budget.data, categoryId, selectedCategory?.name, budgetMonth, transaction, minor]);

  const title = isEdit ? (canSave ? 'Edit transaction' : 'Transaction details') : 'New transaction';

  if (view === 'categories') {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="All categories"
        heading={
          <button onClick={() => setView('form')} className="-ml-2 flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-body font-semibold hover:bg-subtle">
            <ArrowLeft className="size-4" /> All categories
          </button>
        }
        footer={
          offerNewCategory && (
            <>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newCategory.trim()) addCategory.mutate();
                }}
              >
                <label htmlFor="new-category" className="block text-label text-muted">
                  Name it to add a new category to this book (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    id="new-category"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder={type === 'income' ? 'e.g. Rental income' : 'e.g. Pet care'}
                    maxLength={40}
                    autoComplete="off"
                    className={`${inputClass} min-w-0`}
                  />
                  <Button type="submit" variant="secondary" disabled={!newCategory.trim()} loading={addCategory.isPending}>
                    Add
                  </Button>
                </div>
                <ErrorBanner error={addCategory.error} />
              </form>
              <Button className="w-full" onClick={() => setView('form')}>
                Use {selectedCategory!.name}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              placeholder="Search categories"
              aria-label="Search categories"
              className={`${inputClass} pl-10`}
            />
          </div>
          {categoryGroups.length === 0 && <p className="py-6 text-center text-label text-muted">No category matches that.</p>}
          {categoryGroups.map(([label, list]) => (
            <section key={label} aria-label={label || 'Categories'}>
              {label && <p className="mb-1.5 text-caption font-medium text-muted">{label}</p>}
              <div className="overflow-hidden rounded-xl border border-line">
                {list.map((c) => (
                  <CategoryOption
                    key={c.id}
                    category={c}
                    selected={categoryId === c.id}
                    disabled={!canSave}
                    onSelect={() => pickFromList(c)}
                    line={lineById.get(c.id)}
                    currency={book.currency}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Sheet>
    );
  }

  const hasFooter = canSave || canDelete || (isEdit && can('txn.create'));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      heading={
        <Segmented
          className="w-48"
          value={type}
          disabled={!canSave}
          onChange={(t) => {
            setType(t);
            setCategoryId('');
            setNewCategory('');
          }}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />
      }
      footer={
        hasFooter && (
          <>
            <ErrorBanner error={save.error ?? remove.error} />
            {conflict && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  invalidate();
                  onClose();
                }}
              >
                Reload latest version
              </Button>
            )}

            <div className="flex gap-2">
              {canDelete && (
                <Button
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(transaction!.id)}
                  aria-label="Delete transaction"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
              {isEdit && can('txn.create') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAsNew(true);
                    setDate(todayISO());
                    setClientId(newClientId());
                    save.reset();
                  }}
                  aria-label="Add again as a new transaction"
                  title="Add again"
                >
                  <CopyPlus className="size-4" />
                  {!canSave && 'Add again'}
                </Button>
              )}
              {canSave && (
                <Button className="flex-1" disabled={minor <= 0 || !categoryId || conflict} loading={save.isPending} onClick={() => save.mutate()}>
                  {isEdit ? 'Save changes' : type === 'income' ? 'Save income' : 'Save expense'}
                </Button>
              )}
            </div>
          </>
        )
      }
    >
      <div className="space-y-3 [@media(max-height:720px)]:space-y-2">
        <div className="text-center">
          <p aria-live="polite" className={`text-display font-semibold tracking-tight tabular ${amount ? (type === 'income' ? 'text-positive' : 'text-ink') : 'text-muted/50'}`}>
            <span className="sr-only">Amount </span>
            {formatMoney(minor, book.currency)}
          </p>
          {isEdit && (
            <p className="text-caption text-muted">
              Added by {transaction!.createdByName}
              {!canSave && ' · read-only for your role'}
            </p>
          )}
          <div className="min-h-[18px]">
            {canSave && type === 'expense' && budgetCheck && <BudgetHint check={budgetCheck} currency={book.currency} />}
            {offerNewCategory && (
              <button onClick={() => setView('categories')} className="text-label font-medium text-accent">
                Add a new category
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-label font-medium">Category</p>
            {canSave && options.length > strip.length && (
              <button onClick={() => setView('categories')} className="-my-1 flex min-h-7 items-center gap-0.5 text-label font-medium text-accent">
                All {options.length}
                <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>
          <div className="no-scrollbar -mx-5 grid auto-cols-[8.5rem] grid-flow-col grid-rows-2 gap-1.5 overflow-x-auto px-5">
            {strip.map((c) => (
              <CategoryCell
                key={c.id}
                category={c}
                selected={categoryId === c.id}
                disabled={!canSave}
                onSelect={() => setCategoryId(c.id)}
                line={lineById.get(c.id)}
                currency={book.currency}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <label className={`relative flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-label font-medium ${canSave ? 'bg-surface' : 'bg-subtle text-muted'}`}>
            {dateChipLabel(date)}
            <ChevronDown className="size-3.5 text-muted" />
            <input
              type="date"
              value={date}
              disabled={!canSave}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  // Not supported here; the browser's own tap behaviour still opens it.
                }
              }}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
              aria-label="Date"
            />
          </label>
          <input
            value={note}
            disabled={!canSave}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            maxLength={200}
            className={`${inputClass} min-w-0 flex-1`}
            aria-label="Note"
          />
          {canSave && !transaction && (
            <button
              onClick={() => setRepeat(!repeat)}
              aria-pressed={repeat}
              aria-label="Repeat every month"
              className={`grid size-11 shrink-0 place-items-center rounded-lg border transition-colors ${
                repeat ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-muted hover:text-ink'
              }`}
            >
              <Repeat className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
        {repeat && canSave && !transaction && (
          <p className="text-caption text-muted">
            Every month on the {ordinal(Number(date.slice(8, 10)))}
            {Number(date.slice(8, 10)) > 28 && ', or the last day in shorter months'}
          </p>
        )}

        {canSave && (
          <div className="grid grid-cols-3 gap-1.5">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setAmount((a) => applyKey(a, k))}
                className="grid h-12 place-items-center rounded-lg bg-subtle text-title font-medium tabular hover:bg-line/60 active:bg-line [@media(max-height:720px)]:h-10"
                aria-label={k === 'back' ? 'Delete digit' : k}
              >
                {k === 'back' ? <Delete className="size-5" strokeWidth={1.75} /> : k}
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function leftLabel(line: BudgetLineDTO, currency: string): string {
  const left = line.planned - line.spent;
  return left >= 0 ? `${formatMoney(left, currency)} left` : `${formatMoney(-left, currency)} over`;
}

/** A quick-pick button. Budget heads (`line` given) also show what's left. */
function CategoryCell({
  category,
  selected,
  disabled,
  onSelect,
  line,
  currency,
}: {
  category: CategoryDTO;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  line?: BudgetLineDTO;
  currency: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex h-12 min-w-0 flex-col justify-center rounded-lg border px-2.5 text-left text-label transition-colors ${
        selected ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:bg-subtle'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <CategoryGlyph category={category} selected={selected} />
        <span className="truncate">{category.name}</span>
      </span>
      {line && (
        <span className={`truncate text-caption tabular ${selected ? 'text-primary-fg/80' : statusText[lineStatus(line)]}`}>{leftLabel(line, currency)}</span>
      )}
    </button>
  );
}

/** A row in the full category list. */
function CategoryOption({
  category,
  selected,
  disabled,
  onSelect,
  line,
  currency,
}: {
  category: CategoryDTO;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  line?: BudgetLineDTO;
  currency: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-subtle"
    >
      <CategoryTile category={category} size="sm" />
      <span className="min-w-0 flex-1 truncate">{category.name}</span>
      {line && <span className={`shrink-0 text-label tabular ${statusText[lineStatus(line)]}`}>{leftLabel(line, currency)}</span>}
      {selected && <Check className="size-4 shrink-0 text-accent" />}
    </button>
  );
}

/** "Today" or "28 Oct", with the year when it isn't this year's. */
function dateChipLabel(date: string): string {
  const today = todayISO();
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** 1 → "1st", 22 → "22nd". */
function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

type BudgetCheck =
  | { name: string; inBudget: false; monthName: string }
  | { name: string; inBudget: true; planned: number; leftBefore: number; leftAfter: number };

/** "₹4,400 left in Food" — or a warning when this entry takes the head over its limit. */
function BudgetHint({ check, currency }: { check: BudgetCheck; currency: string }) {
  const money = (n: number) => formatMoney(n, currency);
  if (!check.inBudget) {
    return <p className="text-label text-muted">{check.name} isn't a budget head in {check.monthName}.</p>;
  }
  if (check.leftAfter < 0) {
    const alreadyOver = check.leftBefore <= 0;
    return (
      <p role="status" className="text-label text-warning">
        <AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" />
        <strong className="font-semibold">
          {alreadyOver
            ? `${check.name} is already ${money(-check.leftBefore)} over budget.`
            : `This goes ${money(-check.leftAfter)} over your ${check.name} budget.`}
        </strong>{' '}
        You can still save it.
      </p>
    );
  }
  return (
    <p className="text-label text-muted tabular">
      {money(check.leftAfter)} left in {check.name} after this · limit {money(check.planned)}
    </p>
  );
}
