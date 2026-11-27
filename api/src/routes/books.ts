import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  activityQuerySchema,
  backupSchema,
  BOOK_COLORS,
  bookCreateSchema,
  normalizeSections,
  bookUpdateSchema,
  canManageMember,
  inviteCreateSchema,
  memberUpdateSchema,
  ROLE_LABELS,
  transferSchema,
  BOOK_RESTORE_DAYS,
  type ActivityDTO,
  type DeletedBookDTO,
  type InviteCreatedDTO,
  type InviteDTO,
  type MemberDTO,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { AccountDoc, BookDoc, BudgetDoc, CategoryDoc, InviteDoc, RecurringDoc, TransactionDoc, TransferDoc } from '../db.ts';
import { env } from '../env.ts';
import { createBook, diff, logActivity, toBookDTO } from '../lib/books.ts';
import { badRequest, forbidden, notFound, oid, parse } from '../lib/errors.ts';
import { randomToken, sha256 } from '../lib/tokens.ts';
import { limitWrites, requireAuth } from '../middleware/auth.ts';
import { requireBook, requirePermission } from '../middleware/book.ts';
import { accountRoutes } from './accounts.ts';
import { budgetRoutes } from './budget.ts';
import { exportRoutes } from './export.ts';
import { ledgerRoutes } from './ledger.ts';
import { recurringRoutes } from './recurring.ts';

function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 3)}•••••${phone.slice(-4)}` : '•••';
}

async function memberCounts(db: AppEnv['Variables']['db'], bookIds: ObjectId[]) {
  const rows = await db.bookMembers
    .aggregate<{ _id: ObjectId; n: number }>([
      { $match: { bookId: { $in: bookIds } } },
      { $group: { _id: '$bookId', n: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id.toHexString(), r.n]));
}

// ── routes inside one book (caller must be a member) ──
const bookRoutes = new Hono<AppEnv>()
  .use('*', requireBook, limitWrites)

  .get('/', async (c) => {
    const book = c.get('book');
    const counts = await memberCounts(c.get('db'), [book._id]);
    return c.json(toBookDTO(book, c.get('role'), counts.get(book._id.toHexString()) ?? 1));
  })

  .patch('/', requirePermission('book.settings'), async (c) => {
    const input = parse(bookUpdateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const changes = diff(book, input);
    if (Object.keys(changes).length) {
      await db.books.updateOne({ _id: book._id }, { $set: { ...input, updatedAt: new Date() } });
      await logActivity(db, {
        bookId: book._id,
        userId: c.get('userId'),
        action: 'settings',
        entity: 'book',
        entityId: book._id,
        summary: `updated book settings (${Object.keys(changes).join(', ')})`,
        diff: changes,
      });
    }
    const updated = { ...book, ...input };
    const counts = await memberCounts(db, [book._id]);
    return c.json(toBookDTO(updated, c.get('role'), counts.get(book._id.toHexString()) ?? 1));
  })

  .delete('/', requirePermission('book.delete'), async (c) => {
    const book = c.get('book');
    if (book.isPersonal) throw badRequest('Your Personal book cannot be deleted');
    await c.get('db').books.updateOne({ _id: book._id }, { $set: { deletedAt: new Date() } });
    await logActivity(c.get('db'), { bookId: book._id, userId: c.get('userId'), action: 'delete', entity: 'book', entityId: book._id, summary: 'deleted the book' });
    return c.body(null, 204);
  })

  // ── members ──
  .get('/members', async (c) => {
    const db = c.get('db');
    const members = await db.bookMembers.find({ bookId: c.get('book')._id }).sort({ joinedAt: 1 }).toArray();
    const users = await db.users
      .find({ _id: { $in: members.map((m) => m.userId) } }, { projection: { name: 1, phone: 1 } })
      .toArray();
    const byId = new Map(users.map((u) => [u._id.toHexString(), u]));
    const showPhones = c.get('role') === 'owner' || c.get('role') === 'admin';
    const result: MemberDTO[] = members.map((m) => {
      const u = byId.get(m.userId.toHexString());
      return {
        userId: m.userId.toHexString(),
        name: u?.name ?? 'Unknown',
        phone: u ? (showPhones ? u.phone : maskPhone(u.phone)) : '',
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      };
    });
    return c.json(result);
  })

  .patch('/members/:userId', requirePermission('members.manage'), async (c) => {
    const { role } = parse(memberUpdateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const targetId = oid(c.req.param('userId'));
    const target = await db.bookMembers.findOne({ bookId: book._id, userId: targetId });
    if (!target) throw notFound('Member not found');
    if (!canManageMember(c.get('role'), { role: target.role, isSelf: targetId.equals(c.get('userId')) }, role)) {
      throw forbidden("You can't change this member's role");
    }
    if (target.role !== role) {
      await db.bookMembers.updateOne({ _id: target._id }, { $set: { role } });
      await logActivity(db, {
        bookId: book._id,
        userId: c.get('userId'),
        action: 'role_change',
        entity: 'member',
        entityId: targetId,
        summary: `changed a member's role from ${ROLE_LABELS[target.role].name} to ${ROLE_LABELS[role].name}`,
        diff: { role: { from: target.role, to: role } },
      });
    }
    return c.json({ userId: targetId.toHexString(), role });
  })

  .delete('/members/:userId', requirePermission('members.manage'), async (c) => {
    const db = c.get('db');
    const book = c.get('book');
    const targetId = oid(c.req.param('userId'));
    const target = await db.bookMembers.findOne({ bookId: book._id, userId: targetId });
    if (!target) throw notFound('Member not found');
    if (!canManageMember(c.get('role'), { role: target.role, isSelf: targetId.equals(c.get('userId')) })) {
      throw forbidden("You can't remove this member");
    }
    await db.bookMembers.deleteOne({ _id: target._id });
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'remove',
      entity: 'member',
      entityId: targetId,
      summary: `removed a ${ROLE_LABELS[target.role].name.toLowerCase()} from the book`,
    });
    return c.body(null, 204);
  })

  .post('/leave', async (c) => {
    const db = c.get('db');
    const book = c.get('book');
    if (c.get('role') === 'owner') {
      throw badRequest('Transfer ownership to another member before leaving this book');
    }
    await db.bookMembers.deleteOne({ bookId: book._id, userId: c.get('userId') });
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'leave',
      entity: 'member',
      entityId: c.get('userId'),
      summary: 'left the book',
    });
    return c.body(null, 204);
  })

  .post('/transfer', requirePermission('book.transfer'), async (c) => {
    const { userId } = parse(transferSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    if (book.isPersonal) throw badRequest('Your Personal book cannot be transferred');
    const targetId = new ObjectId(userId);
    if (targetId.equals(c.get('userId'))) throw badRequest('You already own this book');
    const target = await db.bookMembers.findOne({ bookId: book._id, userId: targetId });
    if (!target) throw notFound('Member not found');
    await db.bookMembers.updateOne({ _id: target._id }, { $set: { role: 'owner' } });
    await db.bookMembers.updateOne({ bookId: book._id, userId: c.get('userId') }, { $set: { role: 'admin' } });
    await db.books.updateOne({ _id: book._id }, { $set: { ownerId: targetId, updatedAt: new Date() } });
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'transfer',
      entity: 'book',
      entityId: book._id,
      summary: 'transferred ownership of the book',
    });
    return c.body(null, 204);
  })

  // ── invites ──
  .get('/invites', requirePermission('members.invite'), async (c) => {
    const db = c.get('db');
    const invites = await db.invites
      .find({
        bookId: c.get('book')._id,
        usedAt: { $exists: false },
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .toArray();
    const creators = await db.users
      .find({ _id: { $in: invites.map((i) => i.createdBy) } }, { projection: { name: 1 } })
      .toArray();
    const names = new Map(creators.map((u) => [u._id.toHexString(), u.name]));
    return c.json(invites.map((i) => toInviteDTO(i, names.get(i.createdBy.toHexString()) ?? 'Unknown')));
  })

  .post('/invites', requirePermission('members.invite'), async (c) => {
    const input = parse(inviteCreateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    if (book.isPersonal) {
      throw badRequest('Your Personal book is private. Create a new book to share with others.');
    }
    const token = randomToken(24);
    const now = new Date();
    const invite: InviteDoc = {
      _id: new ObjectId(),
      bookId: book._id,
      role: input.role,
      tokenHash: sha256(token),
      ...(input.phone ? { phone: input.phone } : {}),
      createdBy: c.get('userId'),
      createdAt: now,
      expiresAt: new Date(now.getTime() + env().inviteTtlDays * 86_400_000),
    };
    await db.invites.insertOne(invite);
    const result: InviteCreatedDTO = { ...toInviteDTO(invite, c.get('user').name), token };
    return c.json(result, 201);
  })

  .delete('/invites/:inviteId', requirePermission('members.invite'), async (c) => {
    const res = await c
      .get('db')
      .invites.updateOne(
        { _id: oid(c.req.param('inviteId')), bookId: c.get('book')._id, usedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } },
      );
    if (res.matchedCount === 0) throw notFound('Invite not found');
    return c.body(null, 204);
  })

  // ── activity ──
  .get('/activity', requirePermission('activity.view'), async (c) => {
    const db = c.get('db');
    const q = parse(activityQuerySchema, c.req.query());
    const rows = await db.activity
      .find({
        bookId: c.get('book')._id,
        ...(q.before ? { at: { $lt: new Date(q.before) } } : {}),
        ...(q.userId ? { userId: new ObjectId(q.userId) } : {}),
        ...(q.entity ? { entity: q.entity } : {}),
      })
      .sort({ at: -1 })
      .limit(50)
      .toArray();
    const users = await db.users
      .find({ _id: { $in: rows.map((r) => r.userId) } }, { projection: { name: 1 } })
      .toArray();
    const names = new Map(users.map((u) => [u._id.toHexString(), u.name]));
    const result: ActivityDTO[] = rows.map((r) => ({
      id: r._id!.toHexString(),
      userName: names.get(r.userId.toHexString()) ?? 'Former member',
      action: r.action,
      entity: r.entity,
      entityId: r.entityId.toHexString(),
      summary: r.summary,
      at: r.at.toISOString(),
    }));
    return c.json(result);
  })

  .route('/', ledgerRoutes)
  .route('/', budgetRoutes)
  .route('/', recurringRoutes)
  .route('/', exportRoutes)
  .route('/', accountRoutes);

function toInviteDTO(invite: InviteDoc, createdByName: string): InviteDTO {
  return {
    id: invite._id.toHexString(),
    role: invite.role,
    phone: invite.phone ?? null,
    createdByName,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

// ── book list / create ──
export const booksRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const db = c.get('db');
    const memberships = await db.bookMembers.find({ userId: c.get('userId') }).toArray();
    const roleByBook = new Map(memberships.map((m) => [m.bookId.toHexString(), m.role]));
    const books = await db.books
      .find({ _id: { $in: memberships.map((m) => m.bookId) }, deletedAt: { $exists: false } })
      .sort({ isPersonal: -1, name: 1 })
      .toArray();
    const counts = await memberCounts(db, books.map((b) => b._id));
    return c.json(
      books.map((b) => {
        const id = b._id.toHexString();
        return toBookDTO(b, roleByBook.get(id)!, counts.get(id) ?? 1);
      }),
    );
  })

  .post('/', async (c) => {
    const input = parse(bookCreateSchema, await c.req.json());
    const book = await createBook(c.get('db'), c.get('userId'), input);
    return c.json(toBookDTO(book, 'owner', 1), 201);
  })

  // Restore a JSON backup (Export → Everything → JSON) as a new book owned by this person. Entries are
  // recorded as added by them, since the people in the original book may not have accounts here.
  .post('/import', async (c) => {
    const input = parse(backupSchema, await c.req.json());
    const db = c.get('db');
    const userId = c.get('userId');
    const now = new Date();
    const scoped = { createdBy: userId, updatedBy: userId, version: 0, createdAt: now, updatedAt: now };
    const book: BookDoc = {
      _id: new ObjectId(),
      name: `${input.book.name} (restored)`.slice(0, 40),
      currency: input.book.currency,
      color: BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)]!,
      ownerId: userId,
      isPersonal: false,
      sections: normalizeSections(input.book.sections, input.book.groupOrder),
      createdAt: now,
      updatedAt: now,
    };

    const idMap = new Map<string, { id: ObjectId; kind: 'income' | 'expense' }>();
    const categories: CategoryDoc[] = input.categories.map((cat, i) => {
      const id = new ObjectId();
      idMap.set(cat.id, { id, kind: cat.kind });
      return {
        _id: id,
        bookId: book._id,
        name: cat.name,
        kind: cat.kind,
        icon: cat.icon,
        color: cat.color,
        sort: i,
        archived: cat.archived,
        ...(cat.kind === 'expense' && (cat.section || cat.group) ? { group: book.sections!.some((s) => s.id === cat.section) ? cat.section : cat.group } : {}),
        ...(cat.goal ? { goal: { target: cat.goal.target, by: cat.goal.by && /^\d{4}-\d{2}$/.test(cat.goal.by) ? cat.goal.by : null, start: cat.goal.start ?? 0 } } : {}),
        ...scoped,
      };
    });
    // Sub-categories: point at the restored parent (only if it's top-level and the same kind).
    for (const [i, cat] of input.categories.entries()) {
      const parent = cat.parentId ? idMap.get(cat.parentId) : undefined;
      const parentDoc = parent && categories.find((x) => x._id.equals(parent.id));
      const parentIsTop = parentDoc && !input.categories.find((x) => x.id === cat.parentId)?.parentId;
      if (parent && parent.kind === cat.kind && parentIsTop && cat.parentId !== cat.id) categories[i]!.parentId = parent.id;
    }
    const mapped = (oldId: string, kind: 'income' | 'expense') => {
      const hit = idMap.get(oldId);
      return hit && hit.kind === kind ? hit.id : null;
    };

    const accountMap = new Map<string, ObjectId>();
    const accounts: AccountDoc[] = input.accounts.map((a, i) => {
      const id = new ObjectId();
      accountMap.set(a.id, id);
      return { _id: id, bookId: book._id, name: a.name, kind: a.kind, openingBalance: a.openingBalance, openingDate: a.openingDate, archived: a.archived, sort: i, ...scoped };
    });
    const transfers: TransferDoc[] = input.transfers.flatMap((t) => {
      const from = accountMap.get(t.fromAccountId);
      const to = accountMap.get(t.toAccountId);
      return from && to && !from.equals(to) ? [{ _id: new ObjectId(), bookId: book._id, fromAccountId: from, toAccountId: to, amount: t.amount, date: t.date, note: t.note, ...scoped }] : [];
    });

    let skipped = 0;
    const transactions: TransactionDoc[] = [];
    for (const t of input.transactions) {
      const categoryId = mapped(t.categoryId, t.type);
      if (!categoryId) {
        skipped++;
        continue;
      }
      const accountId = t.accountId ? accountMap.get(t.accountId) : undefined;
      transactions.push({
        _id: new ObjectId(),
        bookId: book._id,
        type: t.type,
        amount: t.amountMinor,
        date: t.date,
        categoryId,
        note: t.note,
        ...(t.tags?.length ? { tags: t.tags } : {}),
        ...(accountId ? { accountId } : {}),
        ...scoped,
      });
    }
    const byMonth = new Map<string, BudgetDoc>();
    for (const b of input.budgets) {
      const lines = b.lines.flatMap((l) => {
        const categoryId = mapped(l.categoryId, 'expense');
        return categoryId ? [{ categoryId, planned: l.planned }] : [];
      });
      byMonth.set(b.month, { _id: new ObjectId(), bookId: book._id, month: b.month, income: b.income, lines, ...scoped });
    }
    const recurring: RecurringDoc[] = input.recurring.flatMap((r) => {
      const categoryId = mapped(r.categoryId, r.type);
      if (!categoryId) return [];
      return [{ _id: new ObjectId(), bookId: book._id, type: r.type, amount: r.amount, categoryId, note: r.note, dayOfMonth: r.dayOfMonth, startMonth: r.startMonth, ...(r.everyMonths && r.everyMonths !== 1 ? { everyMonths: r.everyMonths } : {}), ...(r.endMonth ? { endMonth: r.endMonth } : {}), active: r.active, skippedMonths: [], ...scoped }];
    });

    await db.books.insertOne(book);
    await db.bookMembers.insertOne({ _id: new ObjectId(), bookId: book._id, userId, role: 'owner', joinedAt: now });
    if (categories.length) await db.categories.insertMany(categories);
    for (let i = 0; i < transactions.length; i += 1000) await db.transactions.insertMany(transactions.slice(i, i + 1000), { ordered: false });
    if (byMonth.size) await db.budgets.insertMany([...byMonth.values()]);
    if (recurring.length) await db.recurring.insertMany(recurring);
    if (accounts.length) await db.accounts.insertMany(accounts);
    if (transfers.length) await db.transfers.insertMany(transfers);
    await logActivity(db, {
      bookId: book._id,
      userId,
      action: 'create',
      entity: 'book',
      entityId: book._id,
      summary: `restored the book from a backup (${transactions.length} transactions, ${byMonth.size} budget month${byMonth.size === 1 ? '' : 's'})`,
    });
    return c.json(
      {
        book: toBookDTO(book, 'owner', 1),
        counts: { categories: categories.length, transactions: transactions.length, budgets: byMonth.size, recurring: recurring.length, skipped },
      },
      201,
    );
  })

  // Books this person owns and deleted recently; they can be brought back for BOOK_RESTORE_DAYS.
  .get('/deleted', async (c) => {
    const since = new Date(Date.now() - BOOK_RESTORE_DAYS * 86_400_000);
    const books = await c
      .get('db')
      .books.find({ ownerId: c.get('userId'), deletedAt: { $gte: since } })
      .sort({ deletedAt: -1 })
      .toArray();
    const result: DeletedBookDTO[] = books.map((b) => ({
      id: b._id.toHexString(),
      name: b.name,
      color: b.color,
      deletedAt: b.deletedAt!.toISOString(),
      restoreUntil: new Date(b.deletedAt!.getTime() + BOOK_RESTORE_DAYS * 86_400_000).toISOString(),
    }));
    return c.json(result);
  })

  .post('/:bookId/restore', async (c) => {
    const db = c.get('db');
    const since = new Date(Date.now() - BOOK_RESTORE_DAYS * 86_400_000);
    const id = oid(c.req.param('bookId'));
    const book = await db.books.findOneAndUpdate(
      { _id: id, ownerId: c.get('userId'), deletedAt: { $gte: since } },
      { $unset: { deletedAt: '' }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!book) throw notFound('This book can no longer be restored');
    await logActivity(db, { bookId: book._id, userId: c.get('userId'), action: 'restore', entity: 'book', entityId: book._id, summary: 'restored the book' });
    const counts = await memberCounts(db, [book._id]);
    return c.json(toBookDTO(book, 'owner', counts.get(book._id.toHexString()) ?? 1));
  })

  .route('/:bookId', bookRoutes);
