import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  canModifyRecord,
  categoryCreateSchema,
  formatMoney,
  monthSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  type CategoryDTO,
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

function monthRange(month: string) {
  return { $gte: `${month}-01`, $lte: `${month}-31` };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
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
    await db.transactions.updateOne(
      { _id: id, bookId },
      { $set: { deletedAt: new Date(), updatedBy: c.get('userId') }, $inc: { version: 1 } },
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
