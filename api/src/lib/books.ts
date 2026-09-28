import { ObjectId } from 'mongodb';
import { BOOK_COLORS, DEFAULT_CATEGORIES, permissionsFor, type BookDTO, type Role } from '@ffos/shared';
import type { ActivityDoc, BookDoc, Collections } from '../db.ts';

export async function createBook(
  db: Collections,
  ownerId: ObjectId,
  input: { name: string; currency: string; color?: string; isPersonal?: boolean },
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
    DEFAULT_CATEGORIES.map((cat, i) => ({
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
  };
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
