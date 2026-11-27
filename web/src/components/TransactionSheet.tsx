import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, CopyPlus, Delete, Plus, Repeat, Search, SlidersHorizontal, Split, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  canModifyRecord,
  formatMoney,
  isCatchAllCategory,
  toMinor,
  type BudgetLineDTO,
  type CategoryDTO,
  type HeadGroup,
  type TagDTO,
  type TransactionDTO,
} from '@ffos/shared';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { leftLabel, limitOf, lineStatus, sortBySection, statusText, useBudget, useMembers, useSections } from '../lib/budget.ts';
import { sameEntry, useFavourites } from '../lib/favourites.ts';
import { lastAccountId, rememberAccount, useAccounts } from '../lib/accounts.ts';
import { currentMonth, monthLabel, periodOfDate, todayISO } from '../lib/format.ts';
import { enqueue, isNetworkError, newClientId } from '../lib/offline.ts';
import { recentCategoryIds, rememberCategory } from '../lib/recent.ts';
import { loadSnapshot, saveSnapshot } from '../lib/snapshot.ts';
import { CategoryTile } from './CategoryIcon.tsx';
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

// Without a budget, how many categories the quick picks show; the rest are under "All".
const STRIP_SIZE = 12;
// Quick picks come in pages of 3 columns × 2 rows, swiped sideways.
const PAGE_SIZE = 6;

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
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  transaction?: TransactionDTO | null;
  /** For a new entry: the date (follows the month being viewed) and, optionally, a category, amount and note. */
  prefill?: { categoryId?: string; date?: string; amount?: number; note?: string };
}) {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useCategories(book.id);
  const { favourites, add: addFavourite, remove: removeFavourite } = useFavourites(book.id);
  const accounts = useAccounts(book.id, open);
  const liveAccounts = (accounts.data ?? []).filter((a) => !a.archived || a.id === accountId);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [forMemberId, setForMemberId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // Split: the rest of the amount goes to other categories; the chosen category gets what's left.
  const [parts, setParts] = useState<{ categoryId: string; amount: string }[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
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
    setAmount(initial ? String(initial.amount / 100) : prefill?.amount ? String(prefill.amount / 100) : '');
    setDate(initial?.date ?? prefill?.date ?? todayISO());
    setCategoryId(initial?.categoryId ?? prefill?.categoryId ?? '');
    setNote(initial?.note ?? prefill?.note ?? '');
    setNewCategory('');
    setRepeat(false);
    setTags(initial?.tags ?? []);
    setTagDraft('');
    setForMemberId(initial?.forMemberId ?? null);
    // New entries start on the account last used here; existing ones keep theirs.
    setAccountId(initial ? initial.accountId : lastAccountId(book.id));
    setParts([]);
    setMoreOpen(Boolean(initial?.tags?.length || initial?.forMemberId));
    setAsNew(false);
    setView('form');
    setCategorySearch('');
    setClientId(newClientId());
    addCategory.reset();
    save.reset();
    remove.reset();
  }, [open, initial, prefill]);

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

  // A tag still being typed counts when saving.
  const allTags = () => (tagDraft.trim() ? [...tags, tagDraft.trim()] : tags).slice(0, 8);
  const splitParts = () =>
    parts.flatMap((p) => {
      const minorPart = toMinor(p.amount) ?? 0;
      return p.categoryId && minorPart > 0 ? [{ categoryId: p.categoryId, amount: minorPart }] : [];
    });
  const mainAmount = () => (toMinor(amount) ?? 0) - splitParts().reduce((s, p) => s + p.amount, 0);
  // An account that's since been closed or deleted is dropped rather than failing the save.
  const usableAccount = () => (accountId && accounts.data?.some((a) => a.id === accountId && !a.archived) ? accountId : undefined);
  const extras = () => ({ tags: allTags(), forMemberId: forMemberId ?? undefined, accountId: usableAccount() });
  const newBody = () => ({ type, amount: mainAmount(), date, categoryId, note, clientId, ...extras(), ...(repeat ? { repeatMonthly: true } : {}) });
  // Each split part is its own entry with the same date, note, tags and person.
  const partBodies = () => splitParts().map((p, i) => ({ type, amount: p.amount, date, categoryId: p.categoryId, note, clientId: `${clientId}-p${i + 1}`, ...extras() }));
  const save = useMutation({
    mutationFn: async () => {
      if (transaction) {
        const body = { type, amount: toMinor(amount) ?? 0, date, categoryId, note, tags: allTags(), forMemberId, accountId: usableAccount() ?? (initial?.accountId === accountId ? undefined : null) };
        return api.patch<TransactionDTO>(`/books/${book.id}/transactions/${transaction.id}`, { ...body, version: transaction.version });
      }
      const main = await api.post<TransactionDTO>(`/books/${book.id}/transactions`, newBody());
      for (const part of partBodies()) await api.post<TransactionDTO>(`/books/${book.id}/transactions`, part);
      return main;
    },
    // Run even when the browser says it's offline (React Query would otherwise pause the save
    // indefinitely), so it fails fast and lands in the offline queue below.
    networkMode: 'always',
    // No connection: keep a new entry on this device and send it when the connection returns.
    onError: (err) => {
      if (transaction || !isNetworkError(err)) return;
      // Already-saved parts are skipped by their clientId when the queue syncs.
      for (const body of [newBody(), ...partBodies()]) enqueue({ bookId: book.id, body });
      rememberCategory(book.id, categoryId);
      onClose();
      toast({ message: "You're offline. Saved on this device; it will sync when you're back online.", duration: 5000 });
    },
    onSuccess: () => {
      rememberCategory(book.id, categoryId);
      rememberAccount(book.id, usableAccount() ?? null);
      invalidate();
      onClose();
      // Going over a bill or spending head: offer to cover it from another head straight away.
      if (type === 'expense' && budgetCheck?.inBudget && budgetCheck.group !== 'savings' && budgetCheck.leftAfter < 0) {
        const month = budgetMonth;
        const id = categoryId;
        toast({
          message: `${budgetCheck.name} is ${formatMoney(-budgetCheck.leftAfter, book.currency)} over budget`,
          ...(can('budget.manage')
            ? { action: { label: 'Cover it', onClick: () => navigate(`/budget?cover=${id}${month === currentMonth() ? '' : `&month=${month}`}`) } }
            : {}),
        });
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

  const members = useMembers(book.id, open && moreOpen && book.memberCount > 1);
  const tagSuggestions = useQuery({
    queryKey: ['book', book.id, 'tags'],
    queryFn: () => api.get<TagDTO[]>(`/books/${book.id}/tags`),
    enabled: open && moreOpen,
    staleTime: 5 * 60_000,
  });
  const addTag = (raw: string) => {
    const tag = raw.replace(/[,#]/g, '').trim().slice(0, 24);
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase()) && tags.length < 8) setTags([...tags, tag]);
    setTagDraft('');
  };
  const current = { type, amount: toMinor(amount) ?? 0, categoryId, note, tags };
  const isFavourite = favourites.some((f) => sameEntry(f, current));

  const isEdit = Boolean(transaction);
  const canSave = isEdit
    ? canModifyRecord(book.role, 'update', transaction!.createdBy, user!.id)
    : can('txn.create');
  const canDelete = isEdit && canModifyRecord(book.role, 'delete', transaction!.createdBy, user!.id);
  const minor = toMinor(amount) ?? 0;
  const budgetMonth = periodOfDate(date);
  const budget = useBudget(book.id, budgetMonth, open && type === 'expense');
  const recent = useMemo(() => (open ? recentCategoryIds(book.id) : []), [open, book.id]);
  // This month's budget heads first (in plan order), then the ones this person used most
  // recently, then the rest in the book's order, "Other" last.
  // A person's own allowance heads come first for them.
  const isMine = (id: string) => categories.data?.find((c) => c.id === id)?.memberId === user?.id;
  // Plan order is section by section, in the book's section order.
  const sections = useSections();
  const headOrder = new Map(
    sortBySection(budget.data?.lines ?? [], sections).map((l, i) => [l.categoryId, (isMine(l.categoryId) ? -500 : 0) + i]),
  );
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

  // Quick picks. With a budget: every head, in the plan's order (arranged on the Budget page), so each
  // head is always in the same spot. Without one: the order above. The selected one always shows.
  const stripHeads = budgetOptions.length > 0;
  let strip = stripHeads ? budgetOptions : options.slice(0, STRIP_SIZE);
  if (selectedCategory && !strip.includes(selectedCategory)) strip = [selectedCategory, ...strip];
  const pages: CategoryDTO[][] = [];
  for (let i = 0; i < strip.length; i += PAGE_SIZE) pages.push(strip.slice(i, i + PAGE_SIZE));
  const stripRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pageStride = () => {
    const el = stripRef.current;
    const first = el?.children[0] as HTMLElement | undefined;
    const second = el?.children[1] as HTMLElement | undefined;
    return first && second ? second.offsetLeft - first.offsetLeft : (el?.clientWidth ?? 1);
  };
  // Opening on an entry whose category is on a later page shows that page.
  const selectedPage = Math.max(0, Math.floor(strip.findIndex((c) => c.id === categoryId) / PAGE_SIZE));
  useEffect(() => {
    if (!open || view !== 'form') return;
    const el = stripRef.current;
    if (el) el.scrollLeft = selectedPage * pageStride();
    setPage(selectedPage);
  }, [open, view, type, initial]);
  const searchText = categorySearch.trim().toLowerCase();
  const parentName = (c: CategoryDTO) => (c.parentId ? categories.data?.find((p) => p.id === c.parentId)?.name : undefined);
  // Typing "groceries" also finds what's inside Groceries.
  const matchesSearch = (c: CategoryDTO) => `${parentName(c) ?? ''} ${c.name}`.toLowerCase().includes(searchText);
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
      transaction && transaction.type === 'expense' && transaction.categoryId === categoryId && periodOfDate(transaction.date) === budgetMonth
        ? transaction.amount
        : 0;
    const leftBefore = limitOf(line) - (line.spent - alreadyCounted);
    // With a split, only the chosen category's share counts against it.
    const share = parts.length ? Math.max(0, mainAmount()) : minor;
    return { name, inBudget: true as const, group: line.group, planned: limitOf(line), leftBefore, leftAfter: leftBefore - share };
  }, [budget.data, categoryId, selectedCategory?.name, budgetMonth, transaction, minor, parts]);

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
                    parent={parentName(c)}
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
                <Button className="flex-1" disabled={minor <= 0 || !categoryId || conflict || (parts.length > 0 && mainAmount() <= 0)} loading={save.isPending} onClick={() => save.mutate()}>
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
          {!isEdit && canSave && !amount && favourites.some((f) => f.type === type) && (
            <div className="no-scrollbar -mx-5 mt-1 flex gap-1.5 overflow-x-auto px-5 pb-1" aria-label="Favourites">
              {favourites
                .filter((f) => f.type === type)
                .map((f) => {
                  const cat = categories.data?.find((c) => c.id === f.categoryId);
                  if (!cat || cat.archived) return null;
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        setAmount(String(f.amount / 100));
                        setCategoryId(f.categoryId);
                        setNote(f.note);
                        setTags(f.tags);
                      }}
                      className="flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-3 text-label whitespace-nowrap hover:bg-subtle"
                    >
                      <Star className="size-3 fill-current text-warning" />
                      {f.note || cat.name} {formatMoney(f.amount, book.currency)}
                    </button>
                  );
                })}
            </div>
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
          <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-label font-medium">
              {stripHeads ? 'Budget category' : 'Category'}
              {pages.length > 1 && (
                <span className="flex gap-1" aria-hidden>
                  {pages.map((_, i) => (
                    <span key={i} className={`size-1.5 rounded-full transition-colors ${i === page ? 'bg-ink' : 'bg-line'}`} />
                  ))}
                </span>
              )}
            </p>
            {canSave && options.length > strip.length && (
              <button onClick={() => setView('categories')} className="-my-1 flex min-h-7 items-center gap-0.5 text-label font-medium text-accent">
                {stripHeads ? 'Other categories' : `All ${options.length}`}
                <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>
          {/* Full pages that snap into place, so no button is ever half off the edge. */}
          <div
            ref={stripRef}
            onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / pageStride()))}
            className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-5 px-5"
          >
            {pages.map((list, i) => (
              <div key={i} className="grid w-full shrink-0 snap-start grid-cols-3 grid-rows-2 gap-1.5" aria-label={pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : undefined}>
                {list.map((c) => (
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
          {canSave && (
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-label="More: tags, who it was for, split, favourite"
              className={`relative grid size-11 shrink-0 place-items-center rounded-lg border transition-colors ${
                moreOpen ? 'border-ink/30 bg-subtle text-ink' : 'border-line bg-surface text-muted hover:text-ink'
              }`}
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.75} />
              {!moreOpen && (tags.length > 0 || forMemberId || parts.length > 0) && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />}
            </button>
          )}
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

        {moreOpen && (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <div>
              <p className="mb-1.5 text-caption font-medium text-muted">Tags</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-subtle pr-1 pl-3 text-label">
                    {t}
                    {canSave && (
                      <button onClick={() => setTags(tags.filter((x) => x !== t))} className="grid size-6 place-items-center rounded-full text-muted hover:text-ink" aria-label={`Remove tag ${t}`}>
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
                {canSave && tags.length < 8 && (
                  <input
                    value={tagDraft}
                    onChange={(e) => (e.target.value.includes(',') ? addTag(e.target.value) : setTagDraft(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(tagDraft);
                      }
                    }}
                    onBlur={() => tagDraft.trim() && addTag(tagDraft)}
                    list="tag-suggestions"
                    placeholder={tags.length ? 'Add another' : 'e.g. trip, office, kids'}
                    maxLength={24}
                    aria-label="Add a tag"
                    className="min-h-8 min-w-28 flex-1 rounded-full border border-dashed border-line bg-transparent px-3 text-label outline-none focus:border-accent"
                  />
                )}
                <datalist id="tag-suggestions">
                  {(tagSuggestions.data ?? [])
                    .filter((t) => !tags.some((x) => x.toLowerCase() === t.tag.toLowerCase()))
                    .slice(0, 30)
                    .map((t) => (
                      <option key={t.tag} value={t.tag} />
                    ))}
                </datalist>
              </div>
            </div>

            {liveAccounts.length > 0 && (
              <div>
                <p className="mb-1.5 text-caption font-medium text-muted">{type === 'income' ? 'Received into' : 'Paid from'}</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ id: null as string | null, name: 'No account' }, ...liveAccounts].map((a) => (
                    <button
                      key={a.id ?? 'none'}
                      disabled={!canSave}
                      onClick={() => setAccountId(a.id)}
                      aria-pressed={accountId === a.id}
                      className={`min-h-8 rounded-full border px-3 text-label ${accountId === a.id ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface'}`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {book.memberCount > 1 && (
              <div>
                <p className="mb-1.5 text-caption font-medium text-muted">For</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ userId: null as string | null, name: 'Everyone' }, ...(members.data ?? [])].map((m) => (
                    <button
                      key={m.userId ?? 'all'}
                      disabled={!canSave}
                      onClick={() => setForMemberId(m.userId)}
                      aria-pressed={forMemberId === m.userId}
                      className={`min-h-8 rounded-full border px-3 text-label ${forMemberId === m.userId ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface'}`}
                    >
                      {m.userId === null ? m.name : m.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {canSave && !transaction && (
              <div>
                <p className="mb-1.5 flex items-center justify-between text-caption font-medium text-muted">
                  <span>Split across categories</span>
                  {parts.length > 0 && (
                    <span className={`tabular ${mainAmount() < 0 ? 'text-negative' : ''}`}>
                      {selectedCategory?.name ?? 'Chosen category'}: {formatMoney(Math.max(0, mainAmount()), book.currency)}
                    </span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {parts.map((p, i) => (
                    <div key={i} className="flex gap-1.5">
                      <select
                        value={p.categoryId}
                        onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}
                        className={`${inputClass} min-h-10 min-w-0 flex-1`}
                        aria-label={`Category for part ${i + 2}`}
                      >
                        <option value="">Category…</option>
                        {options.filter((c) => c.id !== categoryId).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.,]/g, '') } : x)))}
                        placeholder="0"
                        className={`${inputClass} min-h-10 w-24 text-right tabular`}
                        aria-label={`Amount for part ${i + 2}`}
                      />
                      <button onClick={() => setParts(parts.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle" aria-label="Remove part">
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setParts([...parts, { categoryId: '', amount: '' }])}
                    disabled={parts.length >= 5}
                    className="flex min-h-9 items-center gap-1.5 text-label font-medium text-accent disabled:opacity-50"
                  >
                    {parts.length ? <Plus className="size-3.5" /> : <Split className="size-3.5" />} {parts.length ? 'Add another part' : 'Split this amount'}
                  </button>
                  {parts.length > 0 && (
                    <p className="text-caption text-muted">
                      {mainAmount() < 0 ? 'The parts add up to more than the total.' : `Saved as ${splitParts().length + 1} entries with the same date, note and tags.`}
                    </p>
                  )}
                </div>
              </div>
            )}

            {canSave && (current.amount > 0 && categoryId ? (
              <button
                onClick={() => (isFavourite ? removeFavourite(current) : addFavourite(current))}
                aria-pressed={isFavourite}
                className="flex min-h-9 items-center gap-1.5 text-label font-medium text-accent"
              >
                <Star className={`size-4 ${isFavourite ? 'fill-current' : ''}`} /> {isFavourite ? 'Saved as a favourite · remove' : 'Save as a favourite'}
              </button>
            ) : (
              <p className="text-caption text-muted">Enter an amount and category to save it as a favourite for one-tap adding.</p>
            ))}
          </div>
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

/** Done (paid, saved, used exactly) is calm, not a warning. */
const leftTone = (line: BudgetLineDTO) => statusText[lineStatus(line)];

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
      <span className="truncate font-medium">{category.name}</span>
      {line && (
        <span className={`truncate text-caption tabular ${selected ? 'text-primary-fg/80' : leftTone(line)}`}>{leftLabel(line, currency)}</span>
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
  parent,
}: {
  category: CategoryDTO;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  line?: BudgetLineDTO;
  currency: string;
  /** The category it sits inside, shown before its name. */
  parent?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className="flex min-h-12 w-full items-center gap-3 border-b border-line px-3 text-left text-body last:border-b-0 hover:bg-subtle"
    >
      <CategoryTile category={category} size="sm" />
      <span className="min-w-0 flex-1 truncate">
        {parent && <span className="text-muted">{parent} › </span>}
        {category.name}
      </span>
      {line && <span className={`shrink-0 text-label tabular ${leftTone(line)}`}>{leftLabel(line, currency)}</span>}
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
  | { name: string; inBudget: true; group: HeadGroup; planned: number; leftBefore: number; leftAfter: number };

/** "₹4,400 left in Food" — or a warning when this entry takes the head over its limit. */
function BudgetHint({ check, currency }: { check: BudgetCheck; currency: string }) {
  const money = (n: number) => formatMoney(n, currency);
  if (!check.inBudget) {
    return <p className="text-label text-muted">{check.name} isn't in the {check.monthName} budget.</p>;
  }
  if (check.group === 'savings') {
    return (
      <p className="text-label text-muted tabular">
        {check.leftAfter > 0
          ? `${money(check.leftAfter)} more to put aside in ${check.name} after this`
          : `${check.name} is fully put aside for the month`}
      </p>
    );
  }
  if (check.group === 'bills' && check.leftAfter === 0) {
    return <p className="text-label text-muted tabular">This pays {check.name} in full</p>;
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
      {check.group === 'bills'
        ? `${money(check.leftAfter)} of ${check.name} still to pay after this`
        : `${money(check.leftAfter)} left in ${check.name} after this · limit ${money(check.planned)}`}
    </p>
  );
}
