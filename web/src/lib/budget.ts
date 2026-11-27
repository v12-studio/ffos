import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  normalizeGroupOrder,
  type BookDTO,
  type BudgetDTO,
  type BudgetLineDTO,
  type BudgetSuggestionsDTO,
  type CategoryBudgetInput,
  type CategoryDTO,
  type HeadGroup,
  type MemberDTO,
} from '@ffos/shared';
import { api } from './api.ts';
import { useCurrentBook } from './book.tsx';

export function useBudget(bookId: string, month: string, enabled = true) {
  return useQuery({
    queryKey: ['book', bookId, 'budget', month],
    queryFn: () => api.get<BudgetDTO>(`/books/${bookId}/budget/${month}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useBudgetSuggestions(bookId: string, month: string, enabled = true) {
  return useQuery({
    queryKey: ['book', bookId, 'budget', month, 'suggestions'],
    queryFn: () => api.get<BudgetSuggestionsDTO>(`/books/${bookId}/budget/${month}/suggestions`),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useMembers(bookId: string, enabled = true) {
  return useQuery({
    queryKey: ['book', bookId, 'members'],
    queryFn: () => api.get<MemberDTO[]>(`/books/${bookId}/members`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

type Today = BudgetDTO['today'];
type LineLike = Pick<BudgetLineDTO, 'planned' | 'spent'> & Partial<Pick<BudgetLineDTO, 'group' | 'due'>>;

/**
 * How a head is doing, by its group:
 * - spending: ok, `fast` (well ahead of how far the month has gone), `near` (80% used), `over`, or `done` (used exactly)
 * - bills: ok (still to pay), `done` (paid) or `over` (cost more than planned)
 * - savings: ok (still to put aside) or `done`. Putting in more than planned is never a problem.
 */
export type LineStatus = 'ok' | 'fast' | 'near' | 'over' | 'done';

export function lineStatus(line: LineLike, today?: Today): LineStatus {
  const group = line.group ?? 'spending';
  if (group === 'savings') return line.planned > 0 && line.spent >= line.planned ? 'done' : 'ok';
  if (line.spent > line.planned) return 'over';
  if (line.planned > 0 && line.spent === line.planned) return 'done';
  if (group === 'bills') return line.due?.paid ? 'done' : 'ok';
  if (line.planned > 0 && line.spent >= line.planned * 0.8) return 'near';
  if (today && line.planned > 0) {
    const used = line.spent / line.planned;
    const elapsed = today.day / today.daysInMonth;
    if (used >= 0.4 && used > elapsed + 0.2) return 'fast';
  }
  return 'ok';
}

export const needsAttention = (line: LineLike, today?: Today) => {
  const s = lineStatus(line, today);
  return s === 'over' || s === 'near' || s === 'fast';
};

export const statusBar: Record<LineStatus, string> = {
  ok: 'bg-primary',
  fast: 'bg-warning',
  near: 'bg-warning',
  over: 'bg-negative',
  done: 'bg-muted/40',
};

export const statusText: Record<LineStatus, string> = {
  ok: 'text-muted',
  fast: 'text-warning',
  near: 'text-warning',
  over: 'text-negative',
  done: 'text-muted',
};

/** Percentage used, capped for drawing a bar. */
export function usedPct(line: Pick<BudgetLineDTO, 'planned' | 'spent'>): number {
  if (line.planned <= 0) return line.spent > 0 ? 100 : 0;
  return Math.min(100, (line.spent / line.planned) * 100);
}

/** What's left in a head, in the words that fit its group: "₹400 left", "Paid", "₹5,000 to put aside". */
export function leftLabel(line: LineLike, currency: string): string {
  const money = (n: number) => formatMoney(n, currency);
  const left = line.planned - line.spent;
  const group = line.group ?? 'spending';
  if (group === 'savings') {
    if (left > 0) return `${money(left)} to put aside`;
    return line.spent > line.planned ? `${money(line.spent)} saved` : 'Saved';
  }
  if (left < 0) return `${money(-left)} over`;
  if (group === 'bills') {
    if (left === 0 || line.due?.paid) return 'Paid';
    return line.spent > 0 ? `${money(left)} still to pay` : `${money(left)} to pay`;
  }
  return left === 0 && line.planned > 0 ? 'Fully used' : `${money(left)} left`;
}

/** "Seetu" → "savings head"; used in sentences. */
export const groupNoun: Record<HeadGroup, string> = { bills: 'bill', spending: 'spending head', savings: 'savings head' };

/** "5 Nov", or "today" / "tomorrow". */
export function shortDay(date: string, today: string): string {
  if (date === today) return 'today';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  if (t.getTime() - new Date(ty, tm - 1, td).getTime() === 86_400_000) return 'tomorrow';
  return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Saves a changed set of heads for a month. A month that's following an earlier month's plan has no
 * plan of its own yet, so it's created; otherwise the version guards against someone else's save.
 */
export function useSavePlan(bookId: string, month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budget, income, lines }: { budget: BudgetDTO; income?: number; lines: { categoryId: string; planned: number }[] }) =>
      api.put<BudgetDTO>(`/books/${bookId}/budget/${month}`, {
        income: income ?? budget.income,
        lines,
        ...(budget.saved ? { version: budget.version } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['book', bookId, 'budget', month], data);
      queryClient.invalidateQueries({ queryKey: ['book', bookId, 'activity'] });
    },
  });
}

/** Moves `amount` of plan from one head to another. `null` means income not given to any head. */
export function movedLines(budget: BudgetDTO, from: string | null, to: string | null, amount: number) {
  return budget.lines.map((l) => ({
    categoryId: l.categoryId,
    planned: l.planned + (l.categoryId === to ? amount : 0) - (l.categoryId === from ? amount : 0),
  }));
}

/** Marks a bill's monthly entries paid for the month (adds whichever aren't added yet). */
export function usePayBill(bookId: string, month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recurringIds: string[]) => {
      let added = 0;
      for (const id of recurringIds) added += (await api.post<{ added: number }>(`/books/${bookId}/recurring/${id}/pay`, { month })).added;
      return added;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
  });
}

/** Changes a category's group, owner or goal; every budget is refetched since they all show it. */
export function useUpdateHead(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CategoryBudgetInput & { id: string }) => api.patch<CategoryDTO>(`/books/${bookId}/categories/${id}/budget`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<CategoryDTO[]>(['book', bookId, 'categories'], (list = []) => list.map((c) => (c.id === updated.id ? updated : c)));
      queryClient.invalidateQueries({ queryKey: ['book', bookId, 'budget'] });
    },
  });
}

/** The order this book lists its budget sections in (bills, spending, savings unless someone changed it). */
export function useGroupOrder(): HeadGroup[] {
  const { book } = useCurrentBook();
  // A book list saved for offline use before this setting existed has no order yet.
  return normalizeGroupOrder(book.groupOrder);
}

/** Lines grouped into sections in `order`, keeping each section's own order. */
export function sortByGroup<T extends { group: HeadGroup }>(lines: T[], order: HeadGroup[]): T[] {
  return order.flatMap((g) => lines.filter((l) => l.group === g));
}

/** Saves the order of the budget's sections for everyone in the book. */
export function useSaveGroupOrder(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groups: HeadGroup[]) => api.put<{ groupOrder: HeadGroup[] }>(`/books/${bookId}/budget-order`, { groups }),
    onSuccess: ({ groupOrder }) => {
      queryClient.setQueryData<BookDTO[]>(['books'], (list = []) => list.map((b) => (b.id === bookId ? { ...b, groupOrder } : b)));
      queryClient.invalidateQueries({ queryKey: ['book', bookId, 'activity'] });
    },
  });
}
