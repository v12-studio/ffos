import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CopyPlus, Delete, Repeat, Trash2, Wallet } from 'lucide-react';
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
import { lineStatus, statusBar, statusText, useBudget, usedPct } from '../lib/budget.ts';
import { monthLabel, todayISO } from '../lib/format.ts';
import { enqueue, isNetworkError, newClientId } from '../lib/offline.ts';
import { recentCategoryIds, rememberCategory } from '../lib/recent.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { categoryIcon } from './CategoryIcon.tsx';
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? (canSave ? 'Edit transaction' : 'Transaction details') : 'New transaction'}
    >
      <div className="space-y-5">
        {isEdit && (
          <p className="-mt-1 text-[13px] text-muted">
            Added by {transaction!.createdByName}
            {!canSave && ' · read-only for your role'}
          </p>
        )}

        <Segmented
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

        <div className="rounded-xl border border-line bg-subtle/50 px-4 py-4 text-center" aria-live="polite">
          <p className="text-xs font-medium text-muted">Amount</p>
          <p className={`mt-1 text-[34px] leading-tight font-semibold tracking-tight tabular ${amount ? (type === 'income' ? 'text-positive' : 'text-ink') : 'text-muted/50'}`}>
            {formatMoney(minor, book.currency)}
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Category</p>
          {budgetOptions.length > 0 ? (
            <div className="space-y-3">
              <section aria-label={`Budget heads for ${monthLabel(budgetMonth)}`}>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <Wallet className="size-3.5" strokeWidth={2} />
                  In your {monthLabel(budgetMonth)} budget
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {budgetOptions.map((c) => (
                    <CategoryChip
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
              </section>
              {otherOptions.length > 0 && (
                <section aria-label="Categories not in budget">
                  <p className="mb-1.5 text-xs font-medium text-muted">Not in budget</p>
                  <div className="flex flex-wrap gap-2">
                    {otherOptions.map((c) => (
                      <CategoryChip
                        key={c.id}
                        category={c}
                        selected={categoryId === c.id}
                        disabled={!canSave}
                        onSelect={() => setCategoryId(c.id)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((c) => (
                <CategoryChip
                  key={c.id}
                  category={c}
                  selected={categoryId === c.id}
                  disabled={!canSave}
                  onSelect={() => setCategoryId(c.id)}
                />
              ))}
            </div>
          )}

          {offerNewCategory && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newCategory.trim()) addCategory.mutate();
              }}
            >
              <label htmlFor="new-category" className="block text-[13px] text-muted">
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
          )}
        </div>

        {canSave && type === 'expense' && budgetCheck && <BudgetHint check={budgetCheck} currency={book.currency} />}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <input
            type="date"
            value={date}
            disabled={!canSave}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputClass} w-auto!`}
            aria-label="Date"
          />
          <input
            value={note}
            disabled={!canSave}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            maxLength={200}
            className={`${inputClass} min-w-0`}
            aria-label="Note"
          />
        </div>

        {canSave && !transaction && (
          <label className="-mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
            <Repeat className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              Repeat every month on the {ordinal(Number(date.slice(8, 10)))}
              {Number(date.slice(8, 10)) > 28 && <span className="block text-xs text-muted">Or the last day in shorter months</span>}
            </span>
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="size-4.5 accent-(--app-primary)" />
          </label>
        )}

        {canSave && (
          <div className="grid grid-cols-3 gap-1.5">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setAmount((a) => applyKey(a, k))}
                className="grid h-12 place-items-center rounded-lg bg-subtle text-xl font-medium tabular hover:bg-line/60 active:bg-line"
                aria-label={k === 'back' ? 'Delete digit' : k}
              >
                {k === 'back' ? <Delete className="size-5" strokeWidth={1.75} /> : k}
              </button>
            ))}
          </div>
        )}

        {/* Pinned to the bottom so Save stays reachable above the keypad on small phones. */}
        <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-line bg-surface px-5 pt-3">
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
        </div>
      </div>
    </Sheet>
  );
}

/** A category button. Budget heads (`line` given) also show what's left and a usage bar. */
function CategoryChip({
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
  currency?: string;
}) {
  const Icon = categoryIcon(category);
  const tone = selected ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:bg-subtle';
  if (!line) {
    return (
      <button
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${tone}`}
      >
        <Icon className="size-4" strokeWidth={1.75} style={selected ? undefined : { color: category.color }} />
        {category.name}
      </button>
    );
  }
  const status = lineStatus(line);
  const left = line.planned - line.spent;
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${tone}`}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <Icon className="size-4 shrink-0" strokeWidth={1.75} style={selected ? undefined : { color: category.color }} />
        <span className="truncate">{category.name}</span>
      </span>
      <span className={`text-xs tabular ${selected ? 'text-primary-fg/80' : statusText[status]}`}>
        {left >= 0 ? `${formatMoney(left, currency!)} left` : `${formatMoney(-left, currency!)} over`}
      </span>
      <span className={`h-1 w-full overflow-hidden rounded-full ${selected ? 'bg-primary-fg/25' : 'bg-subtle'}`} aria-hidden>
        <span
          className={`block h-full rounded-full ${selected ? 'bg-primary-fg' : statusBar[status]}`}
          style={{ width: `${usedPct(line)}%` }}
        />
      </span>
    </button>
  );
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
    return <p className="-mt-2 text-[13px] text-muted">{check.name} isn't a budget head in {check.monthName}.</p>;
  }
  if (check.leftAfter < 0) {
    const alreadyOver = check.leftBefore <= 0;
    return (
      <div role="status" className="-mt-2 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong className="font-semibold">
            {alreadyOver
              ? `${check.name} is already ${money(-check.leftBefore)} over budget.`
              : `This goes ${money(-check.leftAfter)} over your ${check.name} budget.`}
          </strong>{' '}
          {alreadyOver
            ? ''
            : check.leftBefore === check.planned
              ? `Your ${check.name} limit is ${money(check.planned)}. `
              : `Only ${money(check.leftBefore)} of ${money(check.planned)} was left. `}
          You can still save it.
        </p>
      </div>
    );
  }
  return (
    <p className="-mt-2 text-[13px] text-muted tabular">
      {money(check.leftAfter)} left in {check.name} after this · limit {money(check.planned)}
    </p>
  );
}
