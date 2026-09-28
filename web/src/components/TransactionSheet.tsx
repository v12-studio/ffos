import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Delete, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canModifyRecord, formatMoney, isCatchAllCategory, toMinor, type CategoryDTO, type TransactionDTO } from '@ffos/shared';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { todayISO } from '../lib/format.ts';
import { categoryIcon } from './CategoryIcon.tsx';
import { Button, ErrorBanner, inputClass, Segmented, Sheet } from './ui.tsx';

export function useCategories(bookId: string) {
  return useQuery({
    queryKey: ['book', bookId, 'categories'],
    queryFn: () => api.get<CategoryDTO[]>(`/books/${bookId}/categories`),
    staleTime: 5 * 60_000,
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
  transaction,
}: {
  open: boolean;
  onClose: () => void;
  transaction?: TransactionDTO | null;
}) {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const categories = useCategories(book.id);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [newCategory, setNewCategory] = useState('');

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
    setType(transaction?.type ?? 'expense');
    setAmount(transaction ? String(transaction.amount / 100) : '');
    setDate(transaction?.date ?? todayISO());
    setCategoryId(transaction?.categoryId ?? '');
    setNote(transaction?.note ?? '');
    setNewCategory('');
    addCategory.reset();
  }, [open, transaction]);

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

  const save = useMutation({
    mutationFn: () => {
      const body = { type, amount: toMinor(amount) ?? 0, date, categoryId, note };
      return transaction
        ? api.patch<TransactionDTO>(`/books/${book.id}/transactions/${transaction.id}`, { ...body, version: transaction.version })
        : api.post<TransactionDTO>(`/books/${book.id}/transactions`, body);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/books/${book.id}/transactions/${transaction!.id}`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const isEdit = Boolean(transaction);
  const canSave = isEdit
    ? canModifyRecord(book.role, 'update', transaction!.createdBy, user!.id)
    : can('txn.create');
  const canDelete = isEdit && canModifyRecord(book.role, 'delete', transaction!.createdBy, user!.id);
  const minor = toMinor(amount) ?? 0;
  // Keep "Other" at the end so categories added later sit before it.
  const options = (categories.data ?? [])
    .filter((c) => c.kind === type)
    .sort((a, b) => Number(isCatchAllCategory(a)) - Number(isCatchAllCategory(b)));
  const selectedCategory = options.find((c) => c.id === categoryId);
  const offerNewCategory = canSave && can('txn.create') && selectedCategory !== undefined && isCatchAllCategory(selectedCategory);
  const conflict = save.error instanceof ApiError && save.error.status === 409;

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
          <div className="flex flex-wrap gap-2">
            {options.map((c) => {
              const Icon = categoryIcon(c);
              const selected = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  disabled={!canSave}
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={selected}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${
                    selected ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:bg-subtle'
                  }`}
                >
                  <Icon className="size-4" strokeWidth={1.75} style={selected ? undefined : { color: c.color }} />
                  {c.name}
                </button>
              );
            })}
          </div>

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
                onClick={() => {
                  if (confirm('Delete this transaction?')) remove.mutate();
                }}
                aria-label="Delete transaction"
              >
                <Trash2 className="size-4" />
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
