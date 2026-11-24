import { createMiddleware } from 'hono/factory';
import type { ObjectId } from 'mongodb';
import { can, type Permission } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { Collections } from '../db.ts';
import { forbidden, notFound, oid } from '../lib/errors.ts';

export function loadBookAccess(db: Collections, bookId: ObjectId, userId: ObjectId) {
  return Promise.all([
    db.books.findOne({ _id: bookId, deletedAt: { $exists: false } }),
    db.bookMembers.findOne({ bookId, userId }),
  ]);
}

/**
 * Loads the book from `:bookId` and the caller's membership.
 * Non-members get 404 (not 403) so a book's existence is never revealed.
 * The role is read from the DB on every request, so role changes apply immediately.
 */
export const requireBook = createMiddleware<AppEnv>(async (c, next) => {
  const rawId = c.req.param('bookId');
  const bookId = oid(rawId);
  // requireAuth usually started this lookup in parallel with its own; reuse it to save a round trip.
  const early = c.get('bookAccess');
  const [book, membership] = await (early && early.bookId === rawId
    ? early.result
    : loadBookAccess(c.get('db'), bookId, c.get('userId')));
  if (!book || !membership) throw notFound('Book not found');
  c.set('book', book);
  c.set('role', membership.role);
  await next();
});

export const requirePermission = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.get('role'), permission)) throw forbidden();
    await next();
  });
