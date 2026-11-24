import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query';

// Keeps the last-loaded screens in storage so reopening the app paints straight away from them,
// while every query still refetches in the background (stale-while-revalidate).
// Stored under the snapshot prefix, so sign-out / sign-in wipes it with the other snapshots.
const KEY = 'ffos.snapshot.queries';
// Bump when a DTO shape changes so old cached data is dropped instead of rendered.
const VERSION = 1;
const MAX_AGE = 7 * 24 * 3600_000;
const SAVE_DELAY = 1000;

// Per-book data worth showing instantly. Search results, deleted items, activity and invites are left out:
// they're rarely opened and can grow large.
const BOOK_KINDS = new Set(['summary', 'budget', 'categories', 'trends', 'recurring', 'transactions', 'members']);

function shouldPersist(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  const [scope, , kind, sub] = query.queryKey as unknown[];
  if (scope === 'books') return true;
  if (scope !== 'book' || typeof kind !== 'string' || !BOOK_KINDS.has(kind)) return false;
  return !(kind === 'transactions' && sub === 'search');
}

interface Stored {
  version: number;
  savedAt: number;
  state: DehydratedState;
}

/** Loads the stored cache into the client. Call before the first render. */
export function restoreQueries(queryClient: QueryClient) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Stored;
    if (stored.version !== VERSION || Date.now() - stored.savedAt > MAX_AGE) {
      localStorage.removeItem(KEY);
      return;
    }
    hydrate(queryClient, stored.state);
  } catch {
    // Corrupt or unreadable: start empty.
  }
}

/** Saves the cache shortly after it changes, and right away when the app goes to the background. */
export function persistQueries(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      const state = dehydrate(queryClient, { shouldDehydrateQuery: shouldPersist });
      // Nothing to keep (e.g. just signed out): leave no trace in storage.
      if (!state.queries.length) return localStorage.removeItem(KEY);
      localStorage.setItem(KEY, JSON.stringify({ version: VERSION, savedAt: Date.now(), state } satisfies Stored));
    } catch {
      // Storage full or unavailable: the app still works, it just won't open instantly.
    }
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    timer ??= setTimeout(save, SAVE_DELAY);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden' && timer !== undefined) save();
  };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    unsubscribe();
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
  };
}
