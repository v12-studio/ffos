import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  can,
  canModifyRecord,
  categoryBudgetSchema,
  categoryCreateSchema,
  categoryOrderSchema,
  categoryUpdateSchema,
  currentPeriod,
  DELETED_RETENTION_DAYS,
  formatMoney,
  isCatchAllCategory,
  monthSchema,
  objectIdSchema,
  periodExpression,
  periodOf,
  periodRange,
  sectionFor,
  shiftMonthKey,
  transactionCreateSchema,
  categoryMergeSchema,
  transactionBulkSchema,
  transactionImportSchema,
  transactionSearchSchema,
  transactionUpdateSchema,
  type BudgetSection,
  type CategoryDTO,
  type DeletedTransactionDTO,
  type HeadGroup,
  type ImportResultDTO,
  type PeopleReportDTO,
  type TagDTO,
  type SummaryDTO,
  type TransactionDTO,
  type TransactionSearchDTO,
  type TrendsDTO,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { CategoryDoc, Collections, RecurringDoc, TransactionDoc } from '../db.ts';
import { calendarOf, diff, logActivity, sectionsOf } from '../lib/books.ts';
import { badRequest, conflict, forbidden, HttpError, isDuplicateKey, notFound, oid, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';
import { assertAccount } from './accounts.ts';

// Mounted under /books/:bookId after requireBook, so c.get('book') and c.get('role') are set.
// Every query below filters by bookId.

/** Mongo date filter for budget month `month` (the calendar month, or salary day to salary day). */
export function monthRange(month: string, startDay = 1) {
  const { from, to } = periodRange(month, startDay);
  return { $gte: from, $lte: to };
}

/** Escape user text for use inside a regular expression. */
export function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How a category is tracked in the budget (its section's kind): the one someone chose, else a guess from its name. */
export function headGroupOf(c: Pick<CategoryDoc, 'name' | 'group'>, sections: BudgetSection[]): HeadGroup {
  return sectionFor(c, sections).kind;
}

export function toCategoryDTO(c: CategoryDoc, sections: BudgetSection[]): CategoryDTO {
  return {
    id: c._id.toHexString(),
    name: c.name,
    kind: c.kind,
    icon: c.icon,
    color: c.color,
    archived: c.archived,
    group: headGroupOf(c, sections),
    section: sectionFor(c, sections).id,
    memberId: c.memberId?.toHexString() ?? null,
    goal: c.goal ?? null,
    rollover: c.rollover === true,
    parentId: c.parentId?.toHexString() ?? null,
  };
}

export async function userNames(db: Collections, ids: ObjectId[]) {
  const users = await db.users.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
  return new Map(users.map((u) => [u._id.toHexString(), u.name]));
}

export async function toTransactionDTOs(db: Collections, docs: TransactionDoc[]): Promise<TransactionDTO[]> {
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
    recurringId: t.recurringId?.toHexString() ?? null,
    tags: t.tags ?? [],
    forMemberId: t.forMember?.toHexString() ?? null,
    accountId: t.accountId?.toHexString() ?? null,
  }));
}

export async function assertCategory(db: Collections, bookId: ObjectId, categoryId: string, type: 'income' | 'expense') {
  const category = await db.categories.findOne({ _id: new ObjectId(categoryId), bookId, archived: false });
  if (!category) throw badRequest('Category not found', { categoryId: 'Category not found' });
  if (category.kind !== type) {
    throw badRequest(`Pick an ${type} category`, { categoryId: `Pick an ${type} category` });
  }
  return category;
}

/**
 * A category can sit inside one top-level category of the same kind: not itself, not one that's already
 * a sub-category, and not when it has sub-categories of its own.
 */
async function assertParent(db: Collections, bookId: ObjectId, parentId: string, kind: 'income' | 'expense', selfId?: ObjectId) {
  const parent = await db.categories.findOne({ _id: new ObjectId(parentId), bookId });
  if (!parent || parent.kind !== kind) throw badRequest(`Pick an ${kind} category to put it in`, { parentId: 'Pick a category of the same kind' });
  if (selfId && parent._id.equals(selfId)) throw badRequest("A category can't sit inside itself", { parentId: "Can't be inside itself" });
  if (parent.parentId) throw badRequest(`"${parent.name}" is already inside another category; pick a top-level one`, { parentId: 'Pick a top-level category' });
  if (selfId && (await db.categories.countDocuments({ bookId, parentId: selfId }))) {
    throw badRequest('This category has sub-categories of its own, so it stays top-level', { parentId: 'Has sub-categories' });
  }
  return parent._id;
}

/** The member an entry is for must belong to the book. */
async function assertMember(db: Collections, bookId: ObjectId, userId: string) {
  const member = await db.bookMembers.findOne({ bookId, userId: new ObjectId(userId) }, { projection: { userId: 1 } });
  if (!member) throw badRequest('That person is not a member of this book', { forMemberId: 'Not a member of this book' });
  return member.userId;
}

export const ledgerRoutes = new Hono<AppEnv>()
  // ── categories ──
  // Hidden (archived) categories are included so older transactions still show their name;
  // pickers leave them out.
  .get('/categories', async (c) => {
    const rows = await c.get('db').categories.find({ bookId: c.get('book')._id }).sort({ kind: 1, sort: 1 }).toArray();
    return c.json(rows.map((r) => toCategoryDTO(r, sectionsOf(c.get('book')))));
  })

  // Anyone who can add transactions can add a category while recording one; renaming,
  // hiding and reordering stay with setup.manage.
  .post('/categories', requirePermission('txn.create'), async (c) => {
    const input = parse(categoryCreateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    // Reuse a category with the same name (any case) instead of creating a duplicate,
    // bringing it back if it was hidden.
    const existing = await db.categories.findOne({
      bookId,
      kind: input.kind,
      name: { $regex: `^${escapeRegex(input.name)}$`, $options: 'i' },
    });
    if (existing?.archived) {
      const revived = await db.categories.findOneAndUpdate(
        { _id: existing._id },
        { $set: { archived: false, updatedBy: c.get('userId'), updatedAt: new Date() }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
      return c.json(toCategoryDTO(revived!, sectionsOf(c.get('book'))), 200);
    }
    if (existing) return c.json(toCategoryDTO(existing, sectionsOf(c.get('book'))), 200);
    const last = await db.categories.find({ bookId }).sort({ sort: -1 }).limit(1).next();
    const parentId = input.parentId ? await assertParent(db, bookId, input.parentId, input.kind) : undefined;
    const now = new Date();
    const doc: CategoryDoc = {
      _id: new ObjectId(),
      bookId,
      name: input.name,
      kind: input.kind,
      ...(parentId ? { parentId } : {}),
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
    return c.json(toCategoryDTO(doc, sectionsOf(c.get('book'))), 201);
  })

  // New display order for one kind. Registered before /categories/:id.
  .put('/categories/order', requirePermission('setup.manage'), async (c) => {
    const { kind, ids } = parse(categoryOrderSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    if (ids.length) {
      await db.categories.bulkWrite(
        ids.map((id, i) => ({
          updateOne: { filter: { _id: new ObjectId(id), bookId, kind }, update: { $set: { sort: i } } },
        })),
      );
    }
    const rows = await db.categories.find({ bookId }).sort({ kind: 1, sort: 1 }).toArray();
    return c.json(rows.map((r) => toCategoryDTO(r, sectionsOf(c.get('book')))));
  })

  // How an expense category works as a budget head: its group, whose allowance it is, and a savings goal.
  // Part of planning the budget, so it needs budget.manage rather than setup.manage.
  .patch('/categories/:id/budget', requirePermission('budget.manage'), async (c) => {
    const input = parse(categoryBudgetSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const existing = await db.categories.findOne({ _id: id, bookId });
    if (!existing) throw notFound('Category not found');
    if (existing.kind !== 'expense') throw badRequest('Only expense categories can be in the budget');

    const $set: Partial<CategoryDoc> = {};
    const $unset: Record<string, ''> = {};
    const sections = sectionsOf(c.get('book'));
    const section = input.section
      ? sections.find((s) => s.id === input.section)
      : input.group
        ? sections.find((s) => s.kind === input.group)
        : undefined;
    if ((input.section || input.group) && !section) throw badRequest('That budget section no longer exists. Reload and try again.');
    if (section) $set.group = section.id;
    if (input.rollover === true && !existing.rollover) {
      $set.rollover = true;
      // Counts from this month: what's left at its end is the first amount carried.
      $set.rolloverFrom = currentPeriod(calendarOf(c.get('book')));
    } else if (input.rollover === false && existing.rollover) {
      $unset.rollover = '';
      $unset.rolloverFrom = '';
    }
    if (input.memberId === null) $unset.memberId = '';
    else if (input.memberId) {
      const member = await db.bookMembers.findOne({ bookId, userId: oid(input.memberId) });
      if (!member) throw badRequest('That person is not a member of this book', { memberId: 'Not a member of this book' });
      $set.memberId = member.userId;
    }
    if (input.goal === null) $unset.goal = '';
    else if (input.goal) $set.goal = { target: input.goal.target, by: input.goal.by ?? null, start: input.goal.start ?? 0 };

    const changed = diff(existing, { ...$set, ...Object.fromEntries(Object.keys($unset).map((k) => [k, undefined])) } as Partial<CategoryDoc>);
    if (!Object.keys(changed).length) return c.json(toCategoryDTO(existing, sectionsOf(c.get('book'))));
    const updated = await db.categories.findOneAndUpdate(
      { _id: id, bookId },
      {
        $set: { ...$set, updatedBy: c.get('userId'), updatedAt: new Date() },
        ...(Object.keys($unset).length ? { $unset } : {}),
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    const parts = [
      section && `moved it to ${section.name}`,
      input.rollover !== undefined && input.rollover !== Boolean(existing.rollover) && (input.rollover ? 'turned on carrying over' : 'turned off carrying over'),
      input.memberId !== undefined && (input.memberId ? 'set whose allowance it is' : 'made it shared'),
      input.goal !== undefined && (input.goal ? `set a goal of ${formatMoney(input.goal.target, c.get('book').currency)}` : 'removed its goal'),
    ].filter(Boolean);
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'update',
      entity: 'category',
      entityId: id,
      summary: `changed budget settings for "${existing.name}": ${parts.join(', ')}`,
      diff: changed,
    });
    return c.json(toCategoryDTO(updated!, sectionsOf(c.get('book'))));
  })

  // Rename, recolour, change icon, hide or unhide.
  .patch('/categories/:id', requirePermission('setup.manage'), async (c) => {
    const input = parse(categoryUpdateSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const existing = await db.categories.findOne({ _id: id, bookId });
    if (!existing) throw notFound('Category not found');

    // "Other" is the fallback everyone relies on; it keeps its name and can't be hidden.
    if (isCatchAllCategory(existing)) {
      if (input.name !== undefined && input.name !== existing.name) throw badRequest(`"${existing.name}" can't be renamed`);
      if (input.archived) throw badRequest(`"${existing.name}" can't be hidden`);
    }
    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await db.categories.findOne({
        bookId,
        kind: existing.kind,
        _id: { $ne: id },
        name: { $regex: `^${escapeRegex(input.name)}$`, $options: 'i' },
      });
      if (clash) {
        const message = clash.archived
          ? `A hidden category is already called "${clash.name}". Unhide it instead.`
          : `There's already a category called "${clash.name}"`;
        throw new HttpError(409, 'duplicate_name', message, { name: message });
      }
    }
    const { parentId: parentInput, ...fields } = input;
    const $unset: Record<string, ''> = {};
    const parentSet: Partial<CategoryDoc> = {};
    if (parentInput === null && existing.parentId) $unset.parentId = '';
    else if (parentInput && !existing.parentId?.equals(new ObjectId(parentInput))) parentSet.parentId = await assertParent(db, bookId, parentInput, existing.kind, id);
    if (input.archived === false && existing.archived) {
      // Unhiding puts it back at the end of its list.
      const last = await db.categories.find({ bookId, kind: existing.kind }).sort({ sort: -1 }).limit(1).next();
      Object.assign(fields, { sort: (last?.sort ?? 0) + 1 });
    }

    const changed = { ...diff(existing, { ...fields, ...parentSet } as Partial<CategoryDoc>), ...('parentId' in $unset ? { parentId: { from: existing.parentId, to: null } } : {}) };
    if (!Object.keys(changed).length) return c.json(toCategoryDTO(existing, sectionsOf(c.get('book'))));
    const updated = await db.categories.findOneAndUpdate(
      { _id: id, bookId },
      {
        $set: { ...fields, ...parentSet, updatedBy: c.get('userId'), updatedAt: new Date() },
        ...(Object.keys($unset).length ? { $unset } : {}),
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    const what =
      input.archived === true
        ? `hid category "${existing.name}"`
        : input.archived === false
          ? `unhid category "${existing.name}"`
          : input.name && input.name !== existing.name
            ? `renamed category "${existing.name}" to "${input.name}"`
            : parentInput !== undefined
              ? parentInput
                ? `put category "${existing.name}" inside another`
                : `made category "${existing.name}" top-level`
              : `updated category "${existing.name}"`;
    await logActivity(db, { bookId, userId: c.get('userId'), action: 'update', entity: 'category', entityId: id, summary: what, diff: changed });
    return c.json(toCategoryDTO(updated!, sectionsOf(c.get('book'))));
  })

  // Merge one category into another of the same kind: every entry, repeating entry and budget amount
  // moves across (amounts in the same month's plan are added together), then the old one is removed.
  .post('/categories/:id/merge', requirePermission('setup.manage'), async (c) => {
    const { into } = parse(categoryMergeSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const [source, target] = await Promise.all([db.categories.findOne({ _id: id, bookId }), db.categories.findOne({ _id: new ObjectId(into), bookId, archived: false })]);
    if (!source || !target) throw notFound('Category not found');
    if (source._id.equals(target._id)) throw badRequest('Pick a different category to merge into');
    if (source.kind !== target.kind) throw badRequest(`Pick another ${source.kind} category`);
    if (isCatchAllCategory(source)) throw badRequest(`"${source.name}" can't be merged away; merge other categories into it instead`);

    const [moved] = await Promise.all([
      db.transactions.updateMany({ bookId, categoryId: source._id }, { $set: { categoryId: target._id, updatedAt: new Date() }, $inc: { version: 1 } }),
      db.recurring.updateMany({ bookId, categoryId: source._id }, { $set: { categoryId: target._id, updatedAt: new Date() }, $inc: { version: 1 } }),
    ]);
    const plans = await db.budgets.find({ bookId, 'lines.categoryId': source._id }).toArray();
    for (const plan of plans) {
      const from = plan.lines.find((l) => l.categoryId.equals(source._id))!;
      const lines = plan.lines.some((l) => l.categoryId.equals(target._id))
        ? plan.lines.filter((l) => !l.categoryId.equals(source._id)).map((l) => (l.categoryId.equals(target._id) ? { ...l, planned: l.planned + from.planned } : l))
        : plan.lines.map((l) => (l.categoryId.equals(source._id) ? { ...l, categoryId: target._id } : l));
      await db.budgets.updateOne({ _id: plan._id }, { $set: { lines, updatedAt: new Date() }, $inc: { version: 1 } });
    }
    // Sub-categories of the old one move inside the new one (or become top-level if that's a sub-category itself).
    await db.categories.updateMany({ bookId, parentId: source._id }, target.parentId ? { $unset: { parentId: '' } } : { $set: { parentId: target._id } });
    await db.categories.deleteOne({ _id: source._id });
    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'update',
      entity: 'category',
      entityId: target._id,
      summary: `merged "${source.name}" into "${target.name}" (${moved.modifiedCount} transaction${moved.modifiedCount === 1 ? '' : 's'} moved)`,
    });
    return c.json({ moved: moved.modifiedCount, plans: plans.length });
  })

  // Remove a category nothing uses. One with entries can be hidden, or merged into another.
  .delete('/categories/:id', requirePermission('setup.manage'), async (c) => {
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const id = oid(c.req.param('id'));
    const category = await db.categories.findOne({ _id: id, bookId });
    if (!category) throw notFound('Category not found');
    if (isCatchAllCategory(category)) throw badRequest(`"${category.name}" is always kept`);
    const [entries, rules, plans] = await Promise.all([
      db.transactions.countDocuments({ bookId, categoryId: id }),
      db.recurring.countDocuments({ bookId, categoryId: id }),
      db.budgets.countDocuments({ bookId, 'lines.categoryId': id }),
    ]);
    if (entries || rules || plans) {
      const uses = [entries && `${entries} transaction${entries === 1 ? '' : 's'}`, rules && `${rules} repeating entr${rules === 1 ? 'y' : 'ies'}`, plans && `${plans} month${plans === 1 ? "'s" : "s'"} budget`].filter(Boolean);
      throw conflict(`"${category.name}" is used by ${uses.join(', ')}. Merge it into another category, or hide it.`, 'in_use');
    }
    await db.categories.updateMany({ bookId, parentId: id }, { $unset: { parentId: '' } });
    await db.categories.deleteOne({ _id: id });
    await logActivity(db, { bookId, userId: c.get('userId'), action: 'delete', entity: 'category', entityId: id, summary: `deleted the unused category "${category.name}"` });
    return c.body(null, 204);
  })

  // ── transactions ──
  .get('/transactions', async (c) => {
    const calendar = calendarOf(c.get('book'));
    const month = parse(monthSchema, c.req.query('month') ?? currentPeriod(calendar));
    const createdBy = c.req.query('createdBy');
    const rows = await c
      .get('db')
      .transactions.find({
        bookId: c.get('book')._id,
        deletedAt: { $exists: false },
        date: monthRange(month, calendar.startDay),
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

    // A retried or offline-queued save that already landed: return it instead of adding it twice.
    const alreadySaved = async () => {
      const found = input.clientId ? await db.transactions.findOne({ bookId, clientId: input.clientId }) : null;
      return found ? c.json((await toTransactionDTOs(db, [found]))[0], 200) : null;
    };
    const earlier = await alreadySaved();
    if (earlier) return earlier;

    const category = await assertCategory(db, bookId, input.categoryId, input.type);
    const forMember = input.forMemberId ? await assertMember(db, bookId, input.forMemberId) : null;
    const account = input.accountId ? await assertAccount(db, bookId, input.accountId) : null;
    const now = new Date();
    const doc: TransactionDoc = {
      _id: new ObjectId(),
      bookId,
      type: input.type,
      amount: input.amount,
      date: input.date,
      categoryId: category._id,
      note: input.note,
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(forMember ? { forMember } : {}),
      ...(account ? { accountId: account._id } : {}),
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
    try {
      await db.transactions.insertOne(doc);
    } catch (err) {
      if (isDuplicateKey(err)) {
        const raced = await alreadySaved();
        if (raced) return raced;
      }
      throw err;
    }

    if (input.repeatMonthly) {
      const rule: RecurringDoc = {
        _id: new ObjectId(),
        bookId,
        type: doc.type,
        amount: doc.amount,
        categoryId: doc.categoryId,
        note: doc.note,
        dayOfMonth: Number(doc.date.slice(8, 10)),
        startMonth: periodOf(doc.date, calendarOf(c.get('book')).startDay),
        active: true,
        skippedMonths: [],
        createdBy: doc.createdBy,
        updatedBy: doc.createdBy,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.recurring.insertOne(rule);
      // This entry counts as the first month's, so it isn't offered again.
      await db.transactions.updateOne({ _id: doc._id }, { $set: { recurringId: rule._id } });
      doc.recurringId = rule._id;
    }

    await logActivity(db, {
      bookId,
      userId: c.get('userId'),
      action: 'create',
      entity: 'transaction',
      entityId: doc._id,
      summary: `added ${doc.type} of ${formatMoney(doc.amount, c.get('book').currency)} (${category.name})${
        doc.recurringId ? ', repeating monthly' : ''
      }`,
    });
    const [dto] = await toTransactionDTOs(db, [doc]);
    return c.json(dto, 201);
  })

  // Rows from a spreadsheet, in batches of up to 1000. Rows that match an existing entry (same date, type,
  // amount and note) are skipped unless asked otherwise, so importing the same statement twice is harmless.
  .post('/transactions/import', requirePermission('book.import'), async (c) => {
    const input = parse(transactionImportSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const categoryIds = [...new Set(input.rows.map((r) => r.categoryId))];
    const categories = await db.categories.find({ bookId, _id: { $in: categoryIds.map((id) => new ObjectId(id)) } }, { projection: { kind: 1 } }).toArray();
    const kindOf = new Map(categories.map((cat) => [cat._id.toHexString(), cat.kind]));
    const bad = input.rows.findIndex((r) => kindOf.get(r.categoryId) !== r.type);
    if (bad >= 0) throw badRequest(`Row ${bad + 1}: pick an ${input.rows[bad]!.type} category from this book`);

    const key = (r: { date: string; type: string; amount: number; note: string }) => `${r.date}|${r.type}|${r.amount}|${r.note.trim().toLowerCase()}`;
    const seen = new Set<string>();
    if (input.skipDuplicates) {
      const dates = input.rows.map((r) => r.date).sort();
      const existing = await db.transactions
        .find({ bookId, deletedAt: { $exists: false }, date: { $gte: dates[0]!, $lte: dates.at(-1)! } }, { projection: { date: 1, type: 1, amount: 1, note: 1 } })
        .toArray();
      for (const t of existing) seen.add(key(t));
    }
    const now = new Date();
    const docs: TransactionDoc[] = [];
    let skipped = 0;
    for (const r of input.rows) {
      if (input.skipDuplicates && seen.has(key(r))) {
        skipped++;
        continue;
      }
      if (input.skipDuplicates) seen.add(key(r));
      docs.push({
        _id: new ObjectId(),
        bookId,
        type: r.type,
        amount: r.amount,
        date: r.date,
        categoryId: new ObjectId(r.categoryId),
        note: r.note,
        ...(r.tags?.length ? { tags: r.tags } : {}),
        importId: input.importId,
        createdBy: c.get('userId'),
        updatedBy: c.get('userId'),
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (docs.length) {
      await db.transactions.insertMany(docs, { ordered: false });
      await logActivity(db, {
        bookId,
        userId: c.get('userId'),
        action: 'create',
        entity: 'transaction',
        entityId: docs[0]!._id,
        summary: `imported ${docs.length} transaction${docs.length === 1 ? '' : 's'} from a spreadsheet`,
      });
    }
    const result: ImportResultDTO = { added: docs.length, skipped };
    return c.json(result);
  })

  // Undo an import: its entries move to Recently deleted, so even this can be undone for 30 days.
  .delete('/transactions/import/:importId', requirePermission('book.import'), async (c) => {
    const importId = c.req.param('importId');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(importId)) throw notFound('Import not found');
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const now = new Date();
    const res = await db.transactions.updateMany(
      { bookId, importId, deletedAt: { $exists: false } },
      {
        $set: { deletedAt: now, purgeAt: new Date(now.getTime() + DELETED_RETENTION_DAYS * 86_400_000), updatedBy: c.get('userId'), updatedAt: now },
        $inc: { version: 1 },
      },
    );
    if (res.modifiedCount) {
      await logActivity(db, {
        bookId,
        userId: c.get('userId'),
        action: 'delete',
        entity: 'transaction',
        entityId: bookId,
        summary: `undid an import of ${res.modifiedCount} transaction${res.modifiedCount === 1 ? '' : 's'}`,
      });
    }
    return c.json({ removed: res.modifiedCount });
  })

  // Search every month: ?q= matches the note, category name, tag or who added it. Optional filters:
  // category, type, createdBy, forMember, tag, from/to dates, min/max amount. Sorted newest first unless
  // asked otherwise; 200 a page (?page=1 for the next), with totals over every match.
  .get('/transactions/search', async (c) => {
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const input = parse(transactionSearchSchema, c.req.query());
    const q = (input.q ?? '').trim();
    const filter: Record<string, unknown> = { bookId, deletedAt: { $exists: false } };
    if (input.category) filter.categoryId = new ObjectId(input.category);
    if (input.type) filter.type = input.type;
    if (input.createdBy) filter.createdBy = new ObjectId(input.createdBy);
    if (input.forMember) filter.forMember = new ObjectId(input.forMember);
    if (input.account) filter.accountId = new ObjectId(input.account);
    if (input.tag) filter.tags = { $regex: `^${escapeRegex(input.tag.trim())}$`, $options: 'i' };
    if (input.from || input.to) filter.date = { ...(input.from ? { $gte: input.from } : {}), ...(input.to ? { $lte: input.to } : {}) };
    if (input.min !== undefined || input.max !== undefined) {
      filter.amount = { ...(input.min !== undefined ? { $gte: input.min } : {}), ...(input.max !== undefined ? { $lte: input.max } : {}) };
    }
    if (q) {
      const pattern = { $regex: escapeRegex(q), $options: 'i' };
      const [cats, members] = await Promise.all([
        db.categories.find({ bookId, name: pattern }, { projection: { _id: 1 } }).toArray(),
        db.bookMembers.find({ bookId }, { projection: { userId: 1 } }).toArray(),
      ]);
      const people = await db.users
        .find({ _id: { $in: members.map((m) => m.userId) }, name: pattern }, { projection: { _id: 1 } })
        .toArray();
      filter.$or = [
        { note: pattern },
        { tags: pattern },
        { categoryId: { $in: cats.map((x) => x._id) } },
        { createdBy: { $in: people.map((u) => u._id) } },
      ];
    }
    const LIMIT = 200;
    const page = input.page ?? 0;
    const sort: Record<string, 1 | -1> =
      input.sort === 'oldest'
        ? { date: 1, createdAt: 1 }
        : input.sort === 'largest'
          ? { amount: -1, date: -1 }
          : input.sort === 'smallest'
            ? { amount: 1, date: -1 }
            : { date: -1, createdAt: -1 };
    const [rows, totals] = await Promise.all([
      db.transactions.find(filter).sort(sort).skip(page * LIMIT).limit(LIMIT + 1).toArray(),
      db.transactions.aggregate<{ _id: 'income' | 'expense'; total: number; n: number }>([{ $match: filter }, { $group: { _id: '$type', total: { $sum: '$amount' }, n: { $sum: 1 } } }]).toArray(),
    ]);
    const income = totals.find((t) => t._id === 'income');
    const expense = totals.find((t) => t._id === 'expense');
    const result: TransactionSearchDTO = {
      items: await toTransactionDTOs(db, rows.slice(0, LIMIT)),
      truncated: rows.length > LIMIT,
      totals: { count: (income?.n ?? 0) + (expense?.n ?? 0), income: income?.total ?? 0, expense: expense?.total ?? 0 },
    };
    return c.json(result);
  })

  // Tags used in the book, most used first, for suggestions while typing.
  .get('/tags', async (c) => {
    const rows = await c
      .get('db')
      .transactions.aggregate<{ _id: string; count: number }>([
        { $match: { bookId: c.get('book')._id, deletedAt: { $exists: false }, tags: { $exists: true } } },
        { $unwind: '$tags' },
        { $group: { _id: { $toLower: '$tags' }, count: { $sum: 1 }, tag: { $first: '$tags' } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 200 },
        { $project: { _id: '$tag', count: 1 } },
      ])
      .toArray();
    const result: TagDTO[] = rows.map((r) => ({ tag: r._id, count: r.count }));
    return c.json(result);
  })

  // One change to many entries: delete, restore, change category, add or remove a tag. Entries the
  // person may not change (someone else's, for a contributor) are left alone and counted as skipped.
  .post('/transactions/bulk', requirePermission('txn.create'), async (c) => {
    const input = parse(transactionBulkSchema, await c.req.json());
    const db = c.get('db');
    const bookId = c.get('book')._id;
    const role = c.get('role');
    const userId = c.get('userId');
    const ids = input.ids.map((id) => new ObjectId(id));
    const action = input.action === 'delete' || input.action === 'restore' ? 'delete' : 'update';
    const deleted = input.action === 'restore';
    const docs = await db.transactions.find({ bookId, _id: { $in: ids }, deletedAt: { $exists: deleted } }, { projection: { createdBy: 1, type: 1 } }).toArray();
    let allowed = docs.filter((d) => canModifyRecord(role, action, d.createdBy.toHexString(), userId.toHexString()));
    const now = new Date();
    let summary = '';
    let update: Record<string, unknown> = {};
    if (input.action === 'delete') {
      update = { $set: { deletedAt: now, purgeAt: new Date(now.getTime() + DELETED_RETENTION_DAYS * 86_400_000), updatedBy: userId, updatedAt: now } };
      summary = 'deleted';
    } else if (input.action === 'restore') {
      update = { $unset: { deletedAt: '', purgeAt: '' }, $set: { updatedBy: userId, updatedAt: now } };
      summary = 'restored';
    } else if (input.action === 'category') {
      const category = await db.categories.findOne({ _id: new ObjectId(input.categoryId!), bookId, archived: false });
      if (!category) throw badRequest('Category not found', { categoryId: 'Category not found' });
      // An income entry can't go into an expense category, or the other way round.
      allowed = allowed.filter((d) => d.type === category.kind);
      update = { $set: { categoryId: category._id, updatedBy: userId, updatedAt: now } };
      summary = `moved to ${category.name}:`;
    } else if (input.action === 'addTag') {
      update = { $addToSet: { tags: input.tag! }, $set: { updatedBy: userId, updatedAt: now } };
      summary = `tagged "${input.tag}":`;
    } else {
      update = { $pull: { tags: { $regex: `^${escapeRegex(input.tag!)}$`, $options: 'i' } }, $set: { updatedBy: userId, updatedAt: now } };
      summary = `removed tag "${input.tag}" from`;
    }
    const res = allowed.length ? await db.transactions.updateMany({ _id: { $in: allowed.map((d) => d._id) }, bookId }, { ...update, $inc: { version: 1 } }) : { modifiedCount: 0 };
    if (input.action === 'addTag' && res.modifiedCount) {
      // Keep at most 8 tags on an entry.
      await db.transactions.updateMany({ _id: { $in: allowed.map((d) => d._id) }, 'tags.8': { $exists: true } }, [{ $set: { tags: { $slice: ['$tags', 8] } } }]);
    }
    if (input.action === 'removeTag') await db.transactions.updateMany({ _id: { $in: allowed.map((d) => d._id) }, tags: { $size: 0 } }, { $unset: { tags: '' } });
    if (res.modifiedCount) {
      await logActivity(db, {
        bookId,
        userId,
        action: input.action === 'delete' ? 'delete' : input.action === 'restore' ? 'restore' : 'update',
        entity: 'transaction',
        entityId: allowed[0]!._id,
        summary: `${summary} ${res.modifiedCount} transaction${res.modifiedCount === 1 ? '' : 's'} at once`,
      });
    }
    return c.json({ changed: res.modifiedCount, skipped: input.ids.length - res.modifiedCount });
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

    const { version, categoryId, tags, forMemberId, accountId, ...rest } = input;
    const type = rest.type ?? existing.type;
    const changes: Partial<TransactionDoc> = { ...rest };
    const $unset: Record<string, ''> = {};
    // Only when the list actually changes (diff() below compares arrays by reference).
    if (tags !== undefined && tags.join('\u0000') !== (existing.tags ?? []).join('\u0000')) {
      if (tags.length) changes.tags = tags;
      else $unset.tags = '';
    }
    if (forMemberId === null && existing.forMember) $unset.forMember = '';
    else if (forMemberId) changes.forMember = await assertMember(db, bookId, forMemberId);
    if (accountId === null && existing.accountId) $unset.accountId = '';
    else if (accountId && !existing.accountId?.equals(new ObjectId(accountId))) changes.accountId = (await assertAccount(db, bookId, accountId))._id;
    // Only check the category when it or the type changes, so entries in a since-hidden
    // category can still be edited.
    if ((categoryId && categoryId !== existing.categoryId.toHexString()) || (rest.type && rest.type !== existing.type)) {
      const category = await assertCategory(db, bookId, categoryId ?? existing.categoryId.toHexString(), type);
      changes.categoryId = category._id;
    }
    const changed = {
      ...diff(existing, changes),
      ...Object.fromEntries(Object.keys($unset).map((k) => [k, { from: existing[k as keyof TransactionDoc], to: null }])),
    };
    if (!Object.keys(changed).length) {
      const [dto] = await toTransactionDTOs(db, [existing]);
      return c.json(dto);
    }

    // Optimistic concurrency: only update if nobody saved since the client loaded it.
    const updated = await db.transactions.findOneAndUpdate(
      { _id: id, bookId, version, deletedAt: { $exists: false } },
      {
        $set: { ...changes, updatedBy: c.get('userId'), updatedAt: new Date() },
        ...(Object.keys($unset).length ? { $unset } : {}),
        $inc: { version: 1 },
      },
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

  // ── dashboard summary ──
  .get('/summary', async (c) => {
    const calendar = calendarOf(c.get('book'));
    const month = parse(monthSchema, c.req.query('month') ?? currentPeriod(calendar));
    const db = c.get('db');
    const match = { bookId: c.get('book')._id, deletedAt: { $exists: false }, date: monthRange(month, calendar.startDay) };
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
  })

  // ── by person: ?from=YYYY-MM&to=YYYY-MM (default the last 12 months) ──
  .get('/reports/people', async (c) => {
    const calendar = calendarOf(c.get('book'));
    const to = parse(monthSchema, c.req.query('to') ?? currentPeriod(calendar));
    const from = parse(monthSchema, c.req.query('from') ?? shiftMonthKey(to, -11));
    if (from > to) throw badRequest('The start month must be before the end month');
    const db = c.get('db');
    const match = {
      bookId: c.get('book')._id,
      deletedAt: { $exists: false },
      date: { $gte: periodRange(from, calendar.startDay).from, $lte: periodRange(to, calendar.startDay).to },
    };
    const [added, forWhom] = await Promise.all([
      db.transactions
        .aggregate<{ _id: ObjectId; income: number; expense: number; count: number }>([
          { $match: match },
          {
            $group: {
              _id: '$createdBy',
              income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
              expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
              count: { $sum: 1 },
            },
          },
          { $sort: { expense: -1 } },
        ])
        .toArray(),
      db.transactions
        .aggregate<{ _id: ObjectId | null; expense: number }>([
          { $match: { ...match, type: 'expense' } },
          { $group: { _id: { $ifNull: ['$forMember', null] }, expense: { $sum: '$amount' } } },
          { $sort: { expense: -1 } },
        ])
        .toArray(),
    ]);
    const names = await userNames(db, [...added.map((a) => a._id), ...forWhom.flatMap((f) => (f._id ? [f._id] : []))]);
    const nameOf = (id: ObjectId) => names.get(id.toHexString()) ?? 'Former member';
    const result: PeopleReportDTO = {
      addedBy: added.map((a) => ({ userId: a._id.toHexString(), name: nameOf(a._id), income: a.income, expense: a.expense, count: a.count })),
      forWhom: forWhom.map((f) => ({ userId: f._id?.toHexString() ?? null, name: f._id ? nameOf(f._id) : 'Not marked', expense: f.expense })),
    };
    return c.json(result);
  })

  // ── trends: ?end=YYYY-MM (default this month) &months=N (2–24, default 6) ──
  .get('/trends', async (c) => {
    const calendar = calendarOf(c.get('book'));
    const end = parse(monthSchema, c.req.query('end') ?? currentPeriod(calendar));
    const count = Math.min(24, Math.max(2, Number(c.req.query('months')) || 6));
    const months = Array.from({ length: count }, (_, i) => shiftMonthKey(end, i - count + 1));
    const db = c.get('db');
    const match = {
      bookId: c.get('book')._id,
      deletedAt: { $exists: false },
      date: { $gte: periodRange(months[0]!, calendar.startDay).from, $lte: periodRange(end, calendar.startDay).to },
    };
    const [byType, byCategory] = await Promise.all([
      db.transactions
        .aggregate<{ _id: { month: string; type: 'income' | 'expense' }; total: number }>([
          { $match: match },
          { $group: { _id: { month: periodExpression(calendar.startDay), type: '$type' }, total: { $sum: '$amount' } } },
        ])
        .toArray(),
      db.transactions
        .aggregate<{ _id: { month: string; categoryId: ObjectId }; total: number }>([
          { $match: { ...match, type: 'expense' } },
          { $group: { _id: { month: periodExpression(calendar.startDay), categoryId: '$categoryId' }, total: { $sum: '$amount' } } },
        ])
        .toArray(),
    ]);
    const index = new Map(months.map((m, i) => [m, i]));
    const rows = months.map((month) => ({ month, income: 0, expense: 0 }));
    for (const r of byType) {
      const i = index.get(r._id.month);
      if (i !== undefined) rows[i]![r._id.type] = r.total;
    }
    const perCategory = new Map<string, number[]>();
    for (const r of byCategory) {
      const i = index.get(r._id.month);
      if (i === undefined) continue;
      const key = r._id.categoryId.toHexString();
      const totals = perCategory.get(key) ?? months.map(() => 0);
      totals[i] = r.total;
      perCategory.set(key, totals);
    }
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const result: TrendsDTO = {
      months: rows,
      byCategory: [...perCategory.entries()]
        .map(([categoryId, totals]) => ({ categoryId, totals }))
        .sort((a, b) => sum(b.totals) - sum(a.totals)),
    };
    return c.json(result);
  });
