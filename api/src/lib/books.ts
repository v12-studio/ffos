import { ObjectId } from 'mongodb';
import { APP_TIME_ZONE, BOOK_COLORS, TEMPLATE_CATEGORIES, type BookTemplate, kindOrder, normalizeSections, permissionsFor, type BookCalendar, type BookDTO, type BudgetSection, type Role } from '@ffos/shared';
import type { ActivityDoc, BookDoc, Collections } from '../db.ts';

export async function createBook(
  db: Collections,
  ownerId: ObjectId,
  input: { name: string; currency: string; color?: string; isPersonal?: boolean; template?: BookTemplate },
): Promise<BookDoc> {
  const now = new Date();
  const book: BookDoc = {
    _id: new ObjectId(),
    name: input.name,
    currency: input.currency,
    color: input.color ?? BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)]!,
    ownerId,
    isPersonal: input.isPersonal ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.books.insertOne(book);
  await db.bookMembers.insertOne({ _id: new ObjectId(), bookId: book._id, userId: ownerId, role: 'owner', joinedAt: now });
  await db.categories.insertMany(
    TEMPLATE_CATEGORIES[input.template ?? 'household'].map((cat, i) => ({
      _id: new ObjectId(),
      bookId: book._id,
      ...cat,
      sort: i,
      archived: false,
      createdBy: ownerId,
      updatedBy: ownerId,
      version: 0,
      createdAt: now,
      updatedAt: now,
    })),
  );
  return book;
}

export function toBookDTO(book: BookDoc, role: Role, memberCount: number): BookDTO {
  return {
    id: book._id.toHexString(),
    name: book.name,
    currency: book.currency,
    color: book.color,
    isPersonal: book.isPersonal,
    ownerId: book.ownerId.toHexString(),
    role,
    permissions: permissionsFor(role),
    memberCount,
    sections: sectionsOf(book),
    groupOrder: kindOrder(sectionsOf(book)),
    timeZone: book.timeZone ?? APP_TIME_ZONE,
    monthStartDay: book.monthStartDay ?? 1,
    numberLocale: book.numberLocale ?? 'en-IN',
    alertAt: book.alertAt ?? 80,
  };
}

/** How the book counts "today" and its budget months. */
export function calendarOf(book: Pick<BookDoc, 'timeZone' | 'monthStartDay'>): BookCalendar {
  return { timeZone: book.timeZone ?? APP_TIME_ZONE, startDay: book.monthStartDay ?? 1 };
}

/** The book's budget sections, in order (the three defaults until someone changes them). */
export function sectionsOf(book: Pick<BookDoc, 'sections' | 'groupOrder'>): BudgetSection[] {
  return normalizeSections(book.sections, book.groupOrder);
}

export async function logActivity(db: Collections, entry: Omit<ActivityDoc, '_id' | 'at'>) {
  await db.activity.insertOne({ ...entry, at: new Date() });
}

/** Field-level diff for the activity log; only fields that actually changed. */
export function diff<T extends object>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = (before as Record<string, unknown>)[key];
    const same = from instanceof ObjectId && to instanceof ObjectId ? from.equals(to) : from === to;
    if (!same) out[key] = { from, to };
  }
  return out;
}
