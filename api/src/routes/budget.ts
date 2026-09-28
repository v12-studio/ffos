import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { budgetCopySchema, budgetSaveSchema, formatMoney, monthSchema, type BudgetDTO } from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { BookDoc, BudgetDoc, Collections } from '../db.ts';
import { logActivity } from '../lib/books.ts';
import { badRequest, conflict, isDuplicateKey, notFound, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';
import { monthRange } from './ledger.ts';

// Mounted under /books/:bookId after requireBook. Everyone in the book can view the budget;
// planning it needs budget.manage (owner, admin, editor).

function monthName(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export async function computeBudget(db: Collections, book: BookDoc, month: string): Promise<BudgetDTO> {
  const match = { bookId: book._id, deletedAt: { $exists: false }, date: monthRange(month) };
  const [doc, spentRows, incomeRows] = await Promise.all([
    db.budgets.findOne({ bookId: book._id, month }),
    db.transactions
      .aggregate<{ _id: ObjectId; total: number }>([
        { $match: { ...match, type: 'expense' } },
        { $group: { _id: '$categoryId', total: { $sum: '$amount' } } },
      ])
      .toArray(),
    db.transactions
      .aggregate<{ total: number }>([
        { $match: { ...match, type: 'income' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .toArray(),
  ]);

  const spentBy = new Map(spentRows.map((r) => [r._id.toHexString(), r.total]));
  const income = doc?.income ?? 0;
  const lines = (doc?.lines ?? []).map((l) => {
    const id = l.categoryId.toHexString();
    const spent = spentBy.get(id) ?? 0;
    return { categoryId: id, planned: l.planned, spent, remaining: l.planned - spent };
  });
  const budgeted = new Set(lines.map((l) => l.categoryId));
  const unbudgeted = spentRows
    .filter((r) => !budgeted.has(r._id.toHexString()))
    .map((r) => ({ categoryId: r._id.toHexString(), spent: r.total }))
    .sort((a, b) => b.spent - a.spent);

  const allocated = lines.reduce((sum, l) => sum + l.planned, 0);
  const unbudgetedSpent = unbudgeted.reduce((sum, u) => sum + u.spent, 0);
  return {
    month,
    exists: doc !== null,
    version: doc?.version ?? 0,
    income,
    lines,
    unbudgeted,
    totals: {
      allocated,
      plannedSavings: income - allocated,
      spent: spentRows.reduce((sum, r) => sum + r.total, 0),
      overspent: lines.reduce((sum, l) => sum + Math.max(0, -l.remaining), 0),
      // Assume each head ends at its limit, or where it already is if over.
      projectedSavings: income - lines.reduce((sum, l) => sum + Math.max(l.planned, l.spent), 0) - unbudgetedSpent,
      incomeReceived: incomeRows[0]?.total ?? 0,
    },
  };
}

/** Budget heads must be live expense categories of this book. */
async function assertBudgetHeads(db: Collections, bookId: ObjectId, ids: string[]) {
  if (!ids.length) return;
  const found = await db.categories.countDocuments({
    _id: { $in: ids.map((id) => new ObjectId(id)) },
    bookId,
    kind: 'expense',
    archived: false,
  });
  if (found !== ids.length) throw badRequest('Budget heads must be expense categories in this book');
}

export const budgetRoutes = new Hono<AppEnv>()
  .get('/budget/:month', async (c) => {
    const month = parse(monthSchema, c.req.param('month'));
    return c.json(await computeBudget(c.get('db'), c.get('book'), month));
  })

  .put('/budget/:month', requirePermission('budget.manage'), async (c) => {
    const month = parse(monthSchema, c.req.param('month'));
    const input = parse(budgetSaveSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    await assertBudgetHeads(db, book._id, input.lines.map((l) => l.categoryId));

    const now = new Date();
    const fields = {
      income: input.income,
      lines: input.lines.map((l) => ({ categoryId: new ObjectId(l.categoryId), planned: l.planned })),
      updatedBy: c.get('userId'),
      updatedAt: now,
    };
    const stale = 'Someone else changed this budget. Reload to see the latest plan.';

    if (input.version === undefined) {
      try {
        await db.budgets.insertOne({
          _id: new ObjectId(),
          bookId: book._id,
          month,
          ...fields,
          version: 0,
          createdBy: c.get('userId'),
          createdAt: now,
        });
      } catch (err) {
        if (isDuplicateKey(err)) throw conflict(stale, 'version_conflict');
        throw err;
      }
    } else {
      const updated = await db.budgets.findOneAndUpdate(
        { bookId: book._id, month, version: input.version },
        { $set: fields, $inc: { version: 1 } },
      );
      if (!updated) throw conflict(stale, 'version_conflict');
    }

    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: input.version === undefined ? 'create' : 'update',
      entity: 'budget',
      entityId: book._id,
      summary: `${input.version === undefined ? 'planned' : 'updated'} the ${monthName(month)} budget: income ${formatMoney(
        input.income,
        book.currency,
      )}, ${input.lines.length} budget head${input.lines.length === 1 ? '' : 's'}`,
    });
    return c.json(await computeBudget(db, book, month));
  })

  // Start a month from another month's plan (typically last month).
  .post('/budget/:month/copy', requirePermission('budget.manage'), async (c) => {
    const month = parse(monthSchema, c.req.param('month'));
    const { from } = parse(budgetCopySchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const source = await db.budgets.findOne({ bookId: book._id, month: from });
    if (!source) throw notFound(`There's no plan for ${monthName(from)} to copy`);

    // Skip heads whose category has since been archived.
    const live = new Set(
      (
        await db.categories
          .find({ _id: { $in: source.lines.map((l) => l.categoryId) }, bookId: book._id, archived: false }, { projection: { _id: 1 } })
          .toArray()
      ).map((cat) => cat._id.toHexString()),
    );
    const now = new Date();
    const doc: BudgetDoc = {
      _id: new ObjectId(),
      bookId: book._id,
      month,
      income: source.income,
      lines: source.lines.filter((l) => live.has(l.categoryId.toHexString())),
      version: 0,
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.budgets.insertOne(doc);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(`${monthName(month)} already has a plan`, 'already_planned');
      throw err;
    }
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'create',
      entity: 'budget',
      entityId: book._id,
      summary: `planned the ${monthName(month)} budget from ${monthName(from)}`,
    });
    return c.json(await computeBudget(db, book, month), 201);
  });
