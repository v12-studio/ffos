import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  can,
  canModifyRecord,
  categoryCreateSchema,
  DELETED_RETENTION_DAYS,
  formatMoney,
  monthSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  type CategoryDTO,
  type DeletedTransactionDTO,
  type SummaryDTO,
  type TransactionDTO,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { CategoryDoc, Collections, TransactionDoc } from '../db.ts';
import { diff, logActivity } from '../lib/books.ts';
import { badRequest, conflict, forbidden, notFound, oid, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';

// Mounted under /books/:bookId after requireBook, so c.get('book') and c.get('role') are set.
// Every query below filters by bookId.

export function monthRange(month: string) {
  return { $gte: `${month}-01`, $lte: `${month}-31` };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Quote a CSV cell. Text starting with = + - @ is prefixed with ' so spreadsheet apps
 * don't run a note like "=HYPERLINK(...)" as a formula.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCategoryDTO(c: CategoryDoc): CategoryDTO {
  return { id: c._id.toHexString(), name: c.name, kind: c.kind, icon: c.icon, color: c.color };
}

async function userNames(db: Collections, ids: ObjectId[]) {
  const users = await db.users.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
  return new Map(users.map((u) => [u._id.toHexString(), u.name]));
}

async function toTransactionDTOs(db: Collections, docs: TransactionDoc[]): Promise<TransactionDTO[]> {
  const names = await userNames(db, docs.map((d) => d.createdBy));
  return docs.map((t) => ({
    id: t._id.toHexString(),
    type: t.type,
    amount: t.amount,
    date: t.date,
    categoryId: t.categoryId.toHexString(),
    note: t.note,
    createdBy: t.createdBy.toHexString(),
    createdByName: names.get(t.createdBy.toHexString()) ?? 'Former member',
    updatedBy: t.updatedBy.toHexString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    version: t.version,
  }));
}

async function assertCategory(db: Collections, bookId: ObjectId, categoryId: string, type: 'income' | 'expense') {
  const category = await db.categories.findOne({ _id: new ObjectId(categoryId), bookId, archived: false });
  if (!category) throw badRequest('Category not found', { categoryId: 'Category not found' });
  if (category.kind !== type) {
    throw badRequest(`Pick an ${type} category`, { categoryId: `Pick an ${type} category` });
  }
  return category;
}

export const ledgerRoutes = new Hono<AppEnv>()
  // ── categories ──
  .get('/categories', async (c) => {
    const rows = await c
      .get('db')
      .categories.find({ bookId: c.get('book')._id, archived: false })
      .sort({ kind: 1, sort: 1 })
      .toArray();
    return c.json(rows.map(toCategoryDTO));
  })

  // Anyone who can add transactions can add a category while recording one; renaming and
  // archiving stay with setup.manage.
  .post('/categories', requirePermission('txn.create'), async (c) => {
    const input = parse(categoryCreateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    // Reuse a live category with the same name (any case) instead of creating a duplicate.
    const escaped = input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await db.categories.findOne({
      bookId,
      kind: input.kind,
      archived: false,
      name: { $regex: `^${escaped}$`, $options: 'i' },
    });
    if (existing) return c.json(toCategoryDTO(existing), 200);
    const last = await db.categories.find({ bookId }).sort({ sort: -1 }).limit(1).next();
    const now = new Date();
    const doc: CategoryDoc = {
      _id: new ObjectId(),
      bookId,
      name: input.name,
      kind: input.kind,
      icon: input.icon || 'tag',
      color: input.color ?? '#64748b',
      sort: (last?.sort ?? 0) + 1,
      archived: false,
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.categories.insertOne(doc);
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'create',
      entity: 'category',
      entityId: doc._id,
      summary: `added ${doc.kind} category "${doc.name}"`,
    });
    return c.json(toCategoryDTO(doc), 201);
  })

  // ── transactions ──
  .get('/transactions', async (c) => {
    const month = parse(monthSchema, c.req.query('month') ?? currentMonth());
    const createdBy = c.req.query('createdBy');
    const rows = await c
      .get('db')
      .transactions.find({
        bookId: c.get('book')._id,
        deletedAt: { $exists: false },
        date: monthRange(month),
        ...(createdBy ? { createdBy: oid(createdBy) } : {}),
      })
      .sort({ date: -1, createdAt: -1 })
      .limit(2000)
      .toArray();
    return c.json(await toTransactionDTOs(c.get('db'), rows));
  })

  .post('/transactions', requirePermission('txn.create'), async (c) => {
    const input = parse(transactionCreateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const category = await assertCategory(db, bookId, input.categoryId, input.type);
    const now = new Date();
    const doc: TransactionDoc = {
      _id: new ObjectId(),
      bookId,
      type: input.type,
      amount: input.amount,
      date: input.date,
      categoryId: category._id,
      note: input.note,
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.transactions.insertOne(doc);
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'create',
      entity: 'transaction',
      entityId: doc._id,
      summary: `added ${doc.type} of ${formatMoney(doc.amount, c.get('book').currency)} (${category.name})`,
    });
    const [dto] = await toTransactionDTOs(db, [doc]);
    return c.json(dto, 201);
  })

  .patch('/transactions/:id', async (c) => {
    const input = parse(transactionUpdateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const existing = await db.transactions.findOne({ _id: id, bookId, deletedAt: { $exists: false } });
    if (!existing) throw notFound('Transaction not found');
    if (!canModifyRecord(c.get('role'), 'update', existing.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only edit transactions you added');
    }

    const { version, categoryId, ...rest } = input;
    const type = rest.type ?? existing.type;
    const changes: Partial<TransactionDoc> = { ...rest };
    if (categoryId || rest.type) {
      const category = await assertCategory(db, bookId, categoryId ?? existing.categoryId.toHexString(), type);
      changes.categoryId = category._id;
    }
    const changed = diff(existing, changes);
    if (!Object.keys(changed).length) {
      const [dto] = await toTransactionDTOs(db, [existing]);
      return c.json(dto);
    }

    // Optimistic concurrency: only update if nobody saved since the client loaded it.
    const updated = await db.transactions.findOneAndUpdate(
      { _id: id, bookId, version, deletedAt: { $exists: false } },
      { $set: { ...changes, updatedBy: c.get('userId'), updatedAt: new Date() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) throw conflict('Someone else changed this transaction. Reload to see the latest version.', 'version_conflict');

    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'update',
      entity: 'transaction',
      entityId: id,
      summary: `edited a transaction (${Object.keys(changed).join(', ')})`,
      diff: changed,
    });
    const [dto] = await toTransactionDTOs(db, [updated]);
    return c.json(dto);
  })

  .delete('/transactions/:id', async (c) => {
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const existing = await db.transactions.findOne({ _id: id, bookId, deletedAt: { $exists: false } });
    if (!existing) throw notFound('Transaction not found');
    if (!canModifyRecord(c.get('role'), 'delete', existing.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only delete transactions you added');
    }
    const now = new Date();
    await db.transactions.updateOne(
      { _id: id, bookId },
      {
        $set: {
          deletedAt: now,
          purgeAt: new Date(now.getTime() + DELETED_RETENTION_DAYS * 86_400_000),
          updatedBy: c.get('userId'),
        },
        $inc: { version: 1 },
      },
    );
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'delete',
      entity: 'transaction',
      entityId: id,
      summary: `deleted ${existing.type} of ${formatMoney(existing.amount, c.get('book').currency)} dated ${existing.date}`,
    });
    return c.body(null, 204);
  })

  // Recently deleted: editors+ see everything; contributors see only their own entries.
  .get('/transactions/deleted', async (c) => {
    const role = c.get('role');
    if (!can(role, 'txn.delete.own')) throw forbidden();
    const db = c.get('db');
    const rows = await db.transactions
      .find({
        bookId: c.get('book')._id,
        deletedAt: { $exists: true },
        ...(can(role, 'txn.delete.any') ? {} : { createdBy: c.get('userId') }),
      })
      .sort({ deletedAt: -1 })
      .limit(500)
      .toArray();
    const [dtos, deleters] = await Promise.all([
      toTransactionDTOs(db, rows),
      userNames(db, rows.map((r) => r.updatedBy)),
    ]);
    const result: DeletedTransactionDTO[] = dtos.map((dto, i) => {
      const row = rows[i]!;
      return {
        ...dto,
        deletedAt: row.deletedAt!.toISOString(),
        deletedByName: deleters.get(row.updatedBy.toHexString()) ?? 'Former member',
        purgeAt: (row.purgeAt ?? new Date(row.deletedAt!.getTime() + DELETED_RETENTION_DAYS * 86_400_000)).toISOString(),
      };
    });
    return c.json(result);
  })

  .post('/transactions/:id/restore', async (c) => {
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const existing = await db.transactions.findOne({ _id: id, bookId, deletedAt: { $exists: true } });
    if (!existing) throw notFound('This transaction is no longer in Recently deleted');
    if (!canModifyRecord(c.get('role'), 'delete', existing.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only restore transactions you added');
    }
    const restored = await db.transactions.findOneAndUpdate(
      { _id: id, bookId, deletedAt: { $exists: true } },
      {
        $unset: { deletedAt: '', purgeAt: '' },
        $set: { updatedBy: c.get('userId'), updatedAt: new Date() },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!restored) throw notFound('This transaction is no longer in Recently deleted');
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'restore',
      entity: 'transaction',
      entityId: id,
      summary: `restored ${existing.type} of ${formatMoney(existing.amount, c.get('book').currency)} dated ${existing.date}`,
    });
    const [dto] = await toTransactionDTOs(db, [restored]);
    return c.json(dto);
  })

  // ── export ──
  // ?format=csv (transactions, for spreadsheets) or json (full book backup). Phone numbers are never included.
  .get('/export', requirePermission('book.export'), async (c) => {
    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
    const db = c.get('db');
    const book = c.get('book');
    const [categories, transactions, members] = await Promise.all([
      db.categories.find({ bookId: book._id }).sort({ kind: 1, sort: 1 }).toArray(),
      db.transactions.find({ bookId: book._id, deletedAt: { $exists: false } }).sort({ date: 1, createdAt: 1 }).toArray(),
      db.bookMembers.find({ bookId: book._id }).toArray(),
    ]);
    const names = await userNames(db, [...members.map((m) => m.userId), ...transactions.map((t) => t.createdBy)]);
    const categoryName = new Map(categories.map((cat) => [cat._id.toHexString(), cat.name]));
    const nameOf = (id: ObjectId) => names.get(id.toHexString()) ?? 'Former member';

    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'export',
      entity: 'book',
      entityId: book._id,
      summary: `exported the book (${format.toUpperCase()}, ${transactions.length} transactions)`,
    });

    if (format === 'csv') {
      const header = ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Note', 'Added by', 'Added at'];
      const lines = transactions.map((t) =>
        [
          t.date,
          t.type,
          categoryName.get(t.categoryId.toHexString()) ?? '',
          (t.amount / 100).toFixed(2),
          book.currency,
          t.note,
          nameOf(t.createdBy),
          t.createdAt.toISOString(),
        ]
          .map(csvCell)
          .join(','),
      );
      // BOM so Excel opens UTF-8 (₹, non-English names) correctly.
      const csv = `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
      return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8' });
    }

    return c.json({
      format: 'ffos-book-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: c.get('user').name,
      book: { name: book.name, currency: book.currency, createdAt: book.createdAt.toISOString() },
      members: members.map((m) => ({ name: nameOf(m.userId), role: m.role, joinedAt: m.joinedAt.toISOString() })),
      categories: categories.map((cat) => ({ ...toCategoryDTO(cat), archived: cat.archived })),
      transactions: transactions.map((t) => ({
        id: t._id.toHexString(),
        date: t.date,
        type: t.type,
        amountMinor: t.amount,
        amount: (t.amount / 100).toFixed(2),
        categoryId: t.categoryId.toHexString(),
        category: categoryName.get(t.categoryId.toHexString()) ?? null,
        note: t.note,
        addedBy: nameOf(t.createdBy),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  })

  // ── dashboard summary ──
  .get('/summary', async (c) => {
    const month = parse(monthSchema, c.req.query('month') ?? currentMonth());
    const db = c.get('db');
    const match = { bookId: c.get('book')._id, deletedAt: { $exists: false }, date: monthRange(month) };
    const [totals, byCategory, recent] = await Promise.all([
      db.transactions
        .aggregate<{ _id: 'income' | 'expense'; total: number; n: number }>([
          { $match: match },
          { $group: { _id: '$type', total: { $sum: '$amount' }, n: { $sum: 1 } } },
        ])
        .toArray(),
      db.transactions
        .aggregate<{ _id: ObjectId; total: number }>([
          { $match: { ...match, type: 'expense' } },
          { $group: { _id: '$categoryId', total: { $sum: '$amount' } } },
          { $sort: { total: -1 } },
        ])
        .toArray(),
      db.transactions.find(match).sort({ date: -1, createdAt: -1 }).limit(5).toArray(),
    ]);
    const income = totals.find((t) => t._id === 'income');
    const expense = totals.find((t) => t._id === 'expense');
    const result: SummaryDTO = {
      month,
      income: income?.total ?? 0,
      expense: expense?.total ?? 0,
      net: (income?.total ?? 0) - (expense?.total ?? 0),
      count: (income?.n ?? 0) + (expense?.n ?? 0),
      byCategory: byCategory.map((r) => ({ categoryId: r._id.toHexString(), total: r.total })),
      recent: await toTransactionDTOs(db, recent),
    };
    return c.json(result);
  });
