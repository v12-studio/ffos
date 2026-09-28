import { createMiddleware } from 'hono/factory';
import { can, type Permission } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import { forbidden, notFound, oid } from '../lib/errors.ts';

/**
 * Loads the book from `:bookId` and the caller's membership.
 * Non-members get 404 (not 403) so a book's existence is never revealed.
 * The role is read from the DB on every request, so role changes apply immediately.
 */
export const requireBook = createMiddleware<AppEnv>(async (c, next) => {
  const bookId = oid(c.req.param('bookId'));
  const db = c.get('db');
  const [book, membership] = await Promise.all([
    db.books.findOne({ _id: bookId, deletedAt: { $exists: false } }),
    db.bookMembers.findOne({ bookId, userId: c.get('userId') }),
  ]);
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
