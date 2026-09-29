import { useSyncExternalStore } from 'react';
import type { TransactionCreateInput } from '@ffos/shared';
import { api, ApiError } from './api.ts';

/**
 * New transactions saved without a connection wait here (in this browser only) and are
 * sent when it returns. Each carries a clientId, so an entry that did reach the server
 * before the connection dropped is never recorded twice.
 */
export interface OutboxItem {
  bookId: string;
  body: TransactionCreateInput & { clientId: string };
  queuedAt: string;
}

const KEY = 'ffos.outbox';
const listeners = new Set<() => void>();
let cache: OutboxItem[] | null = null;

function read(): OutboxItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as OutboxItem[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: OutboxItem[]) {
  cache = items;
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the queue lasts until the tab closes.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the queue.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, read);
}

export function enqueue(item: Omit<OutboxItem, 'queuedAt'>) {
  write([...read().filter((i) => i.body.clientId !== item.body.clientId), { ...item, queuedAt: new Date().toISOString() }]);
}

export const isNetworkError = (err: unknown) => err instanceof ApiError && err.status === 0;

export function newClientId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let flushing: Promise<FlushResult> | null = null;

export interface FlushResult {
  sent: number;
  /** Rejected by the server (e.g. category removed, no permission); dropped from the queue. */
  failed: { item: OutboxItem; message: string }[];
}

/** Sends queued entries oldest first; stops at the first network failure. One run at a time. */
export function flushOutbox(): Promise<FlushResult> {
  flushing ??= (async () => {
    const result: FlushResult = { sent: 0, failed: [] };
    for (const item of [...read()]) {
      try {
        await api.post(`/books/${item.bookId}/transactions`, item.body);
        result.sent++;
      } catch (err) {
        if (isNetworkError(err) || (err instanceof ApiError && (err.status === 401 || err.status >= 500))) break;
        result.failed.push({ item, message: err instanceof Error ? err.message : 'Rejected by the server' });
      }
      write(read().filter((i) => i.body.clientId !== item.body.clientId));
    }
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
