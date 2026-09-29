import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  canModifyRecord,
  currentAppMonth,
  formatMoney,
  monthSchema,
  recurringAddSchema,
  recurringCreateSchema,
  recurringDate,
  recurringSkipSchema,
  recurringUpdateSchema,
  todayInAppZone,
  type RecurringDTO,
  type RecurringDueDTO,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { BookDoc, Collections, RecurringDoc, TransactionDoc } from '../db.ts';
import { diff, logActivity } from '../lib/books.ts';
import { badRequest, forbidden, isDuplicateKey, notFound, oid, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';
import { assertCategory, monthRange, userNames } from './ledger.ts';

// Mounted under /books/:bookId after requireBook. Monthly entries (rent, salary, EMIs) that
// the Overview offers to add once their day comes. Anyone who can add transactions can set
// one up; changing or removing it follows the same rules as editing a transaction.

async function toRecurringDTOs(db: Collections, docs: RecurringDoc[]): Promise<RecurringDTO[]> {
  const names = await userNames(db, docs.map((d) => d.createdBy));
  return docs.map((r) => ({
    id: r._id.toHexString(),
    type: r.type,
    amount: r.amount,
    categoryId: r.categoryId.toHexString(),
    note: r.note,
    dayOfMonth: r.dayOfMonth,
    startMonth: r.startMonth,
    active: r.active,
    createdBy: r.createdBy.toHexString(),
    createdByName: names.get(r.createdBy.toHexString()) ?? 'Former member',
    version: r.version,
  }));
}

/**
 * Entries due in `month` that haven't been added or skipped. In the current month only
 * those whose day has come (Mumbai time) are due; future months have nothing due.
 * Entries whose category was hidden are left out until it's unhidden or changed.
 */
async function dueIn(db: Collections, book: BookDoc, month: string) {
  const today = todayInAppZone();
  const thisMonth = today.slice(0, 7);
  if (month > thisMonth) return [];
  const rules = await db.recurring
    .find({ bookId: book._id, active: true, startMonth: { $lte: month }, skippedMonths: { $ne: month } })
    .toArray();
  if (!rules.length) return [];
  const [added, liveCategories] = await Promise.all([
    db.transactions.distinct('recurringId', {
      bookId: book._id,
      recurringId: { $in: rules.map((r) => r._id) },
      deletedAt: { $exists: false },
      date: monthRange(month),
    }),
    db.categories.distinct('_id', { _id: { $in: rules.map((r) => r.categoryId) }, archived: false }),
  ]);
  const addedIds = new Set(added.map((id) => (id as ObjectId).toHexString()));
  const live = new Set(liveCategories.map((id) => id.toHexString()));
  return rules
    .map((rule) => ({ rule, date: recurringDate(month, rule.dayOfMonth) }))
    .filter(({ rule, date }) => !addedIds.has(rule._id.toHexString()) && live.has(rule.categoryId.toHexString()) && date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || b.rule.amount - a.rule.amount);
}

async function findRule(db: Collections, bookId: ObjectId, id: string) {
  const rule = await db.recurring.findOne({ _id: oid(id), bookId });
  if (!rule) throw notFound('Recurring entry not found');
  return rule;
}

export const recurringRoutes = new Hono<AppEnv>()
  .get('/recurring', async (c) => {
    const db = c.get('db');
    const rows = await db.recurring.find({ bookId: c.get('book')._id }).sort({ dayOfMonth: 1, createdAt: 1 }).toArray();
    return c.json(await toRecurringDTOs(db, rows));
  })

  .post('/recurring', requirePermission('txn.create'), async (c) => {
    const input = parse(recurringCreateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const category = await assertCategory(db, bookId, input.categoryId, input.type);
    const now = new Date();
    const doc: RecurringDoc = {
      _id: new ObjectId(),
      bookId,
      type: input.type,
      amount: input.amount,
      categoryId: category._id,
      note: input.note,
      dayOfMonth: input.dayOfMonth,
      startMonth: input.startMonth,
      active: true,
      skippedMonths: [],
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.recurring.insertOne(doc);
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'create',
      entity: 'recurring',
      entityId: doc._id,
      summary: `set up a monthly ${doc.type} of ${formatMoney(doc.amount, c.get('book').currency)} (${category.name}) on day ${doc.dayOfMonth}`,
    });
    const [dto] = await toRecurringDTOs(db, [doc]);
    return c.json(dto, 201);
  })

  .patch('/recurring/:id', async (c) => {
    const input = parse(recurringUpdateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const rule = await findRule(db, bookId, c.req.param('id'));
    if (!canModifyRecord(c.get('role'), 'update', rule.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only change recurring entries you set up');
    }
    const { categoryId, ...rest } = input;
    const changes: Partial<RecurringDoc> = { ...rest };
    const type = input.type ?? rule.type;
    if ((categoryId && categoryId !== rule.categoryId.toHexString()) || type !== rule.type) {
      changes.categoryId = (await assertCategory(db, bookId, categoryId ?? rule.categoryId.toHexString(), type))._id;
    }
    const changed = diff(rule, changes);
    if (Object.keys(changed).length) {
      await db.recurring.updateOne(
        { _id: rule._id },
        { $set: { ...changes, updatedBy: c.get('userId'), updatedAt: new Date() }, $inc: { version: 1 } },
      );
      await logActivity(db, {
        bookId,
        userId: c.get('userId'),
        action: 'update',
        entity: 'recurring',
        entityId: rule._id,
        summary:
          input.active === false
            ? 'paused a monthly entry'
            : input.active === true && !rule.active
              ? 'resumed a monthly entry'
              : `edited a monthly entry (${Object.keys(changed).join(', ')})`,
        diff: changed,
      });
    }
    const [dto] = await toRecurringDTOs(db, [(await db.recurring.findOne({ _id: rule._id }))!]);
    return c.json(dto);
  })

  // Entries already added from it stay; it just stops being offered.
  .delete('/recurring/:id', async (c) => {
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const rule = await findRule(db, bookId, c.req.param('id'));
    if (!canModifyRecord(c.get('role'), 'delete', rule.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only remove recurring entries you set up');
    }
    await db.recurring.deleteOne({ _id: rule._id });
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'delete',
      entity: 'recurring',
      entityId: rule._id,
      summary: `removed a monthly ${rule.type} of ${formatMoney(rule.amount, c.get('book').currency)}`,
    });
    return c.body(null, 204);
  })

  .get('/recurring/due', async (c) => {
    const month = parse(monthSchema, c.req.query('month') ?? currentAppMonth());
    const db = c.get('db');
    const due = await dueIn(db, c.get('book'), month);
    const dtos = await toRecurringDTOs(db, due.map((d) => d.rule));
    const result: RecurringDueDTO = { month, items: due.map((d, i) => ({ recurring: dtos[i]!, date: d.date })) };
    return c.json(result);
  })

  // Adds the chosen due entries as transactions by the caller. Each entry can land at most
  // once per month, even if two members press "Add" at the same time.
  .post('/recurring/due/add', requirePermission('txn.create'), async (c) => {
    const { month, ids } = parse(recurringAddSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const due = (await dueIn(db, book, month)).filter((d) => ids.includes(d.rule._id.toHexString()));
    const now = new Date();
    let added = 0;
    for (const { rule, date } of due) {
      const doc: TransactionDoc = {
        _id: new ObjectId(),
        bookId: book._id,
        type: rule.type,
        amount: rule.amount,
        date,
        categoryId: rule.categoryId,
        note: rule.note,
        createdBy: c.get('userId'),
        updatedBy: c.get('userId'),
        version: 0,
        createdAt: now,
        updatedAt: now,
        recurringId: rule._id,
        clientId: `rec-${rule._id.toHexString()}-${month}`,
      };
      try {
        await db.transactions.insertOne(doc);
        added++;
      } catch (err) {
        // A deleted earlier copy still holds the id: bring it back with today's details.
        if (!isDuplicateKey(err)) throw err;
        const { type, amount, categoryId, note } = doc;
        const restored = await db.transactions.updateOne(
          { bookId: book._id, clientId: doc.clientId, deletedAt: { $exists: true } },
          {
            $unset: { deletedAt: '', purgeAt: '' },
            $set: { type, amount, date, categoryId, note, updatedBy: c.get('userId'), updatedAt: now },
            $inc: { version: 1 },
          },
        );
        added += restored.modifiedCount;
      }
    }
    if (added) {
      await logActivity(db, {
        bookId: book._id,
        userId: c.get('userId'),
        action: 'create',
        entity: 'transaction',
        entityId: book._id,
        summary: `added ${added} monthly entr${added === 1 ? 'y' : 'ies'} for ${month}`,
      });
    }
    return c.json({ added });
  })

  // "Not this month": stops offering it for `month`.
  .post('/recurring/:id/skip', requirePermission('txn.create'), async (c) => {
    const { month } = parse(recurringSkipSchema, await c.req.json());
    const db = c.get('db');
    const rule = await findRule(db, c.get('book')._id, c.req.param('id'));
    if (month < rule.startMonth) throw badRequest("It isn't due that month");
    await db.recurring.updateOne({ _id: rule._id }, { $addToSet: { skippedMonths: month } });
    return c.body(null, 204);
  });
