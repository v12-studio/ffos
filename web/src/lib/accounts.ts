import { useQuery } from '@tanstack/react-query';
import type { AccountDTO } from '@ffos/shared';
import { api } from './api.ts';

export function useAccounts(bookId: string, enabled = true) {
  return useQuery({
    queryKey: ['book', bookId, 'accounts'],
    queryFn: () => api.get<AccountDTO[]>(`/books/${bookId}/accounts`),
    enabled,
    staleTime: 60_000,
  });
}

// The account this person last paid from, per book, so new entries start there. A per-device convenience.
const key = (bookId: string) => `ffos.lastAccount.${bookId}`;

export function lastAccountId(bookId: string): string | null {
  try {
    return localStorage.getItem(key(bookId));
  } catch {
    return null;
  }
}

export function rememberAccount(bookId: string, accountId: string | null) {
  try {
    if (accountId) localStorage.setItem(key(bookId), accountId);
  } catch {
    // ignore
  }
}
