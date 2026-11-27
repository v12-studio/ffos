import { useState } from 'react';

// Entries this person adds often ("Milk ₹60"), saved on this device for each book. One tap on the Add
// screen fills them in.

export interface Favourite {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string;
  note: string;
  tags: string[];
}

const key = (bookId: string) => `ffos.favourites.${bookId}`;
const MAX = 12;

function load(bookId: string): Favourite[] {
  try {
    return (JSON.parse(localStorage.getItem(key(bookId)) ?? '[]') as Favourite[]).filter((f) => f && f.categoryId && f.amount > 0);
  } catch {
    return [];
  }
}

/** Same entry, ignoring which favourite it came from. */
export const sameEntry = (a: Omit<Favourite, 'id'>, b: Omit<Favourite, 'id'>) =>
  a.type === b.type && a.amount === b.amount && a.categoryId === b.categoryId && a.note.trim() === b.note.trim();

export function useFavourites(bookId: string) {
  const [list, setList] = useState(() => load(bookId));
  const [forBook, setForBook] = useState(bookId);
  if (forBook !== bookId) {
    setForBook(bookId);
    setList(load(bookId));
  }
  const persist = (next: Favourite[]) => {
    setList(next);
    try {
      localStorage.setItem(key(bookId), JSON.stringify(next));
    } catch {
      // Storage full or private mode: kept for this visit only.
    }
  };
  return {
    favourites: list,
    add: (f: Omit<Favourite, 'id'>) => persist([{ ...f, id: crypto.randomUUID() }, ...list.filter((x) => !sameEntry(x, f))].slice(0, MAX)),
    remove: (f: Omit<Favourite, 'id'>) => persist(list.filter((x) => !sameEntry(x, f))),
  };
}
