import { useQuery } from '@tanstack/react-query';
import type { BudgetDTO, BudgetLineDTO } from '@ffos/shared';
import { api } from './api.ts';

export function useBudget(bookId: string, month: string, enabled = true) {
  return useQuery({
    queryKey: ['book', bookId, 'budget', month],
    queryFn: () => api.get<BudgetDTO>(`/books/${bookId}/budget/${month}`),
    enabled,
    refetchInterval: 60_000,
  });
}

/** A head is "near" its limit from 80% used; "over" once spending passes the plan. */
export type LineStatus = 'ok' | 'near' | 'over';

export function lineStatus(line: Pick<BudgetLineDTO, 'planned' | 'spent'>): LineStatus {
  if (line.spent > line.planned) return 'over';
  if (line.planned > 0 && line.spent >= line.planned * 0.8) return 'near';
  return 'ok';
}

export const statusBar: Record<LineStatus, string> = {
  ok: 'bg-primary',
  near: 'bg-warning',
  over: 'bg-negative',
};

export const statusText: Record<LineStatus, string> = {
  ok: 'text-muted',
  near: 'text-warning',
  over: 'text-negative',
};

/** Percentage used, capped for drawing a bar. */
export function usedPct(line: Pick<BudgetLineDTO, 'planned' | 'spent'>): number {
  if (line.planned <= 0) return line.spent > 0 ? 100 : 0;
  return Math.min(100, (line.spent / line.planned) * 100);
}
