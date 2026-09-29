import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type BookDTO, type Permission } from '@ffos/shared';
import { api } from './api.ts';
import { loadSnapshot, saveSnapshot } from './snapshot.ts';

const BOOK_KEY = 'ffos.book';

interface BookState {
  books: BookDTO[];
  book: BookDTO | null;
  isLoading: boolean;
  error: unknown;
  selectBook: (id: string) => void;
  can: (permission: Permission) => boolean;
}

const BookContext = createContext<BookState | null>(null);

function readStoredBookId() {
  try {
    return localStorage.getItem(BOOK_KEY);
  } catch {
    return null;
  }
}

export function BookProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(readStoredBookId);
  const booksQuery = useQuery({
    queryKey: ['books'],
    queryFn: async () => {
      const list = await api.get<BookDTO[]>('/books');
      saveSnapshot('books', list);
      return list;
    },
    // Offline start: use the last-known list, and refetch as soon as possible.
    initialData: () => loadSnapshot<BookDTO[]>('books'),
    initialDataUpdatedAt: 0,
  });
  const books = booksQuery.data ?? [];
  // Fall back to the first book if the remembered one is gone (left, removed, deleted).
  const book = books.find((b) => b.id === selectedId) ?? books[0] ?? null;

  useEffect(() => {
    if (!book) return;
    try {
      localStorage.setItem(BOOK_KEY, book.id);
    } catch {
      // ignore
    }
  }, [book]);

  const value = useMemo<BookState>(
    () => ({
      books,
      book,
      isLoading: booksQuery.isLoading,
      error: booksQuery.error,
      selectBook: setSelectedId,
      can: (permission) => can(book?.role, permission),
    }),
    [books, book, booksQuery.isLoading, booksQuery.error],
  );

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook() {
  const ctx = useContext(BookContext);
  if (!ctx) throw new Error('useBook must be used inside BookProvider');
  return ctx;
}

/** The current book, for screens that only render once a book is loaded. */
export function useCurrentBook() {
  const ctx = useBook();
  if (!ctx.book) throw new Error('No book selected');
  return { ...ctx, book: ctx.book };
}
