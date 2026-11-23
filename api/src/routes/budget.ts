import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  budgetCopySchema,
  budgetSaveSchema,
  currentAppMonth,
  daysInMonth,
  formatMoney,
  monthSchema,
  recurringDate,
  shiftMonthKey,
  todayInAppZone,
  type BudgetDTO,
  type BudgetLineDTO,
  type BudgetSuggestionsDTO,
  type HeadGroup,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { BookDoc, BudgetDoc, Collections } from '../db.ts';
import { logActivity } from '../lib/books.ts';
import { badRequest, conflict, isDuplicateKey, notFound, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';
import { headGroupOf, monthRange } from './ledger.ts';

// Mounted under /books/:bookId after requireBook. Everyone in the book can view the budget;
// planning it needs budget.manage (owner, admin, editor).

function monthName(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Whole rupees (minor units rounded to 100): `down` for what can be spent, up for what must be set aside. */
const wholeDown = (minor: number) => Math.floor(minor / 100) * 100;
const wholeUp = (minor: number) => Math.ceil(minor / 100) * 100;

function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

interface Plan {
  income: number;
  lines: { categoryId: ObjectId; planned: number }[];
  version: number;
  saved: boolean;
  carriedFrom: string | null;
}

/**
 * The plan in force for `month`: its own if it has one, otherwise the latest earlier plan carries over,
 * so a budget keeps going month after month without being re-entered. When the current month is
 * opened on a carried plan it's saved as that month's own, so it stays put if an earlier month is edited later.
 */
async function planFor(db: Collections, book: BookDoc, month: string, userId?: ObjectId): Promise<Plan | null> {
  const own = await db.budgets.findOne({ bookId: book._id, month });
  if (own) return { income: own.income, lines: own.lines, version: own.version, saved: true, carriedFrom: own.carriedFrom ?? null };
  const previous = await db.budgets.find({ bookId: book._id, month: { $lt: month } }).sort({ month: -1 }).limit(1).next();
  if (!previous) return null;

  // Heads whose category has since been hidden don't carry over.
  const live = new Set(
    (
      await db.categories
        .find({ _id: { $in: previous.lines.map((l) => l.categoryId) }, bookId: book._id, archived: false }, { projection: { _id: 1 } })
        .toArray()
    ).map((cat) => cat._id.toHexString()),
  );
  const lines = previous.lines.filter((l) => live.has(l.categoryId.toHexString()));

  if (userId && month === currentAppMonth()) {
    const now = new Date();
    try {
      await db.budgets.insertOne({
        _id: new ObjectId(),
        bookId: book._id,
        month,
        income: previous.income,
        lines,
        carriedFrom: previous.month,
        version: 0,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      // Another member opened it at the same moment; theirs is the month's plan.
      if (!isDuplicateKey(err)) throw err;
      return planFor(db, book, month);
    }
    return { income: previous.income, lines, version: 0, saved: true, carriedFrom: previous.month };
  }
  return { income: previous.income, lines, version: 0, saved: false, carriedFrom: previous.month };
}

/** `userId` is the person viewing; with it, opening the current month on a carried plan saves it for the month. */
export async function computeBudget(db: Collections, book: BookDoc, month: string, userId?: ObjectId): Promise<BudgetDTO> {
  const match = { bookId: book._id, deletedAt: { $exists: false }, date: monthRange(month) };
  const [plan, spentRows, incomeRows, categories] = await Promise.all([
    planFor(db, book, month, userId),
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
    db.categories.find({ bookId: book._id, kind: 'expense' }, { projection: { name: 1, group: 1, goal: 1 } }).toArray(),
  ]);

  const categoryById = new Map(categories.map((cat) => [cat._id.toHexString(), cat]));
  const groupOf = (id: string): HeadGroup => {
    const cat = categoryById.get(id);
    return cat ? headGroupOf(cat) : 'spending';
  };
  const planLines = plan?.lines ?? [];
  const lineIds = planLines.map((l) => l.categoryId);

  // Monthly entries behind each head (rent on the 5th), and which of them were already added this month.
  const rules = lineIds.length
    ? await db.recurring
        .find({ bookId: book._id, type: 'expense', active: true, categoryId: { $in: lineIds }, startMonth: { $lte: month }, skippedMonths: { $ne: month } })
        .toArray()
    : [];
  const addedRules = rules.length
    ? new Set(
        (
          await db.transactions.distinct('recurringId', {
            bookId: book._id,
            recurringId: { $in: rules.map((r) => r._id) },
            deletedAt: { $exists: false },
            date: monthRange(month),
          })
        ).map((id) => (id as ObjectId).toHexString()),
      )
    : new Set<string>();

  // Savings goals: everything put in up to the end of this month, and up to the start of it.
  const goalIds = lineIds.filter((id) => categoryById.get(id.toHexString())?.goal);
  const goalRows = goalIds.length
    ? await db.transactions
        .aggregate<{ _id: ObjectId; total: number; before: number }>([
          { $match: { bookId: book._id, deletedAt: { $exists: false }, type: 'expense', categoryId: { $in: goalIds }, date: { $lte: `${month}-31` } } },
          {
            $group: {
              _id: '$categoryId',
              total: { $sum: '$amount' },
              before: { $sum: { $cond: [{ $lt: ['$date', `${month}-01`] }, '$amount', 0] } },
            },
          },
        ])
        .toArray()
    : [];
  const goalTotals = new Map(goalRows.map((r) => [r._id.toHexString(), r]));

  const spentBy = new Map(spentRows.map((r) => [r._id.toHexString(), r.total]));
  const income = plan?.income ?? 0;
  const lines: BudgetLineDTO[] = planLines.map((l) => {
    const id = l.categoryId.toHexString();
    const spent = spentBy.get(id) ?? 0;
    const group = groupOf(id);
    const own = rules.filter((r) => r.categoryId.equals(l.categoryId));
    const due = own.length
      ? {
          date: own.map((r) => recurringDate(month, r.dayOfMonth)).sort()[0]!,
          recurringIds: own.map((r) => r._id.toHexString()),
          paid: own.every((r) => addedRules.has(r._id.toHexString())),
        }
      : null;
    const goalDef = categoryById.get(id)?.goal;
    let goal: BudgetLineDTO['goal'] = null;
    if (goalDef) {
      const totals = goalTotals.get(id);
      const before = goalDef.start + (totals?.before ?? 0);
      const monthsLeft = goalDef.by ? monthsBetween(month, goalDef.by) + 1 : null;
      goal = {
        target: goalDef.target,
        by: goalDef.by,
        saved: goalDef.start + (totals?.total ?? 0),
        monthlyNeeded: monthsLeft === null ? null : wholeUp(Math.max(0, goalDef.target - before) / Math.max(1, monthsLeft)),
      };
    }
    return { categoryId: id, group, planned: l.planned, spent, remaining: l.planned - spent, due, goal };
  });

  const budgeted = new Set(lines.map((l) => l.categoryId));
  const unbudgeted = spentRows
    .filter((r) => !budgeted.has(r._id.toHexString()))
    .map((r) => ({ categoryId: r._id.toHexString(), group: groupOf(r._id.toHexString()), spent: r.total }))
    .sort((a, b) => b.spent - a.spent);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const outgoing = lines.filter((l) => l.group !== 'savings');
  const allocated = sum(lines.map((l) => l.planned));
  const unbudgetedSpent = sum(unbudgeted.filter((u) => u.group !== 'savings').map((u) => u.spent));
  const savedRows = spentRows.filter((r) => groupOf(r._id.toHexString()) === 'savings');

  let today: BudgetDTO['today'] = null;
  if (month === currentAppMonth()) {
    const day = Number(todayInAppZone().slice(8, 10));
    const total = daysInMonth(month);
    const daysLeft = total - day + 1;
    const spendingLeft = sum(lines.filter((l) => l.group === 'spending').map((l) => Math.max(0, l.remaining)));
    today = { day, daysInMonth: total, daysLeft, spendingLeft, safePerDay: wholeDown(spendingLeft / daysLeft) };
  }

  return {
    month,
    exists: plan !== null,
    saved: plan?.saved ?? false,
    carriedFrom: plan?.carriedFrom ?? null,
    version: plan?.version ?? 0,
    income,
    lines,
    unbudgeted,
    totals: {
      allocated,
      unallocated: income - allocated,
      plannedSavings: income - sum(outgoing.map((l) => l.planned)),
      spent: sum(spentRows.map((r) => r.total)) - sum(savedRows.map((r) => r.total)),
      saved: sum(savedRows.map((r) => r.total)),
      overspent: sum(outgoing.map((l) => Math.max(0, -l.remaining))),
      // Assume each bill and spending head ends at its limit, or where it already is if over.
      projectedSavings: income - sum(outgoing.map((l) => Math.max(l.planned, l.spent))) - unbudgetedSpent,
      incomeReceived: incomeRows[0]?.total ?? 0,
    },
    today,
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
    return c.json(await computeBudget(c.get('db'), c.get('book'), month, c.get('userId')));
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
        { $set: fields, $unset: { carriedFrom: '' }, $inc: { version: 1 } },
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

  // What each expense category took in the three months before, to plan from real numbers.
  // Averaged over the months that have any entries, so a new book isn't pulled down by empty months.
  .get('/budget/:month/suggestions', async (c) => {
    const month = parse(monthSchema, c.req.param('month'));
    const db = c.get('db');
    const months = [-3, -2, -1].map((d) => shiftMonthKey(month, d));
    const last = months[2]!;
    const rows = await db.transactions
      .aggregate<{ _id: { categoryId: ObjectId; month: string }; total: number }>([
        {
          $match: {
            bookId: c.get('book')._id,
            deletedAt: { $exists: false },
            type: 'expense',
            date: { $gte: `${months[0]}-01`, $lte: `${last}-31` },
          },
        },
        { $group: { _id: { categoryId: '$categoryId', month: { $substrBytes: ['$date', 0, 7] } }, total: { $sum: '$amount' } } },
      ])
      .toArray();
    const activeMonths = Math.max(1, new Set(rows.map((r) => r._id.month)).size);
    const byCategory = new Map<string, { total: number; last: number }>();
    for (const r of rows) {
      const key = r._id.categoryId.toHexString();
      const entry = byCategory.get(key) ?? { total: 0, last: 0 };
      entry.total += r.total;
      if (r._id.month === last) entry.last = r.total;
      byCategory.set(key, entry);
    }
    const result: BudgetSuggestionsDTO = {
      months,
      // Rounded to ₹10 so the suggestion reads like a number someone would plan.
      byCategory: [...byCategory.entries()].map(([categoryId, e]) => ({
        categoryId,
        average: Math.round(e.total / activeMonths / 1000) * 1000,
        last: e.last,
      })),
    };
    return c.json(result);
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
