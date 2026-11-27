import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  currentAppMonth,
  exportQuerySchema,
  HEAD_GROUP_LABELS,
  normalizeGroupOrder,
  shiftMonthKey,
  type BudgetDTO,
  type ExportFormat,
  type ExportKind,
  type HeadGroup,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { BookDoc, CategoryDoc, Collections } from '../db.ts';
import { logActivity } from '../lib/books.ts';
import { badRequest, notFound, parse } from '../lib/errors.ts';
import { buildXlsx, type ColumnType } from '../lib/xlsx.ts';
import { requirePermission } from '../middleware/book.ts';
import { computeBudget } from './budget.ts';
import { headGroupOf, toCategoryDTO, userNames } from './ledger.ts';

// Mounted under /books/:bookId after requireBook. Phone numbers and deleted items are never included.
//
// GET /export?what=budget|transactions|everything&format=csv|xlsx|json&from=YYYY-MM&to=YYYY-MM&category=<id>
//   budget        plan vs actual for every head, month by month (plus a monthly summary in Excel)
//   transactions  every entry
//   everything    both together: an Excel workbook with a sheet each, or a JSON backup
// from/to limit it to a range of months (either may be left out; neither means all time),
// and category to one head or category. Without `what`, format=csv is transactions and anything else
// is the JSON backup, as before.

/** Most months one budget export covers, so a request can't make the server compute decades of plans. */
const MAX_BUDGET_MONTHS = 120;

/**
 * Quote a CSV cell. Text starting with = + - @ is prefixed with ' so spreadsheet apps
 * don't run a note like "=HYPERLINK(...)" as a formula.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One table of an export: a CSV file, or a sheet in the workbook. Money cells hold minor units. */
interface Table {
  name: string;
  columns: { header: string; type?: ColumnType; width?: number }[];
  rows: (string | number | null)[][];
}

function toCsv(table: Table): string {
  const lines = table.rows.map((row) =>
    row
      .map((v, i) => {
        if (v === null) return '';
        if (typeof v === 'number') return table.columns[i]?.type === 'money' ? (v / 100).toFixed(2) : String(v);
        return csvCell(v);
      })
      .join(','),
  );
  // BOM so Excel opens UTF-8 (₹, non-English names) correctly.
  return `﻿${[table.columns.map((c) => csvCell(c.header)).join(','), ...lines].join('\r\n')}\r\n`;
}

function toXlsx(tables: Table[]): Uint8Array<ArrayBuffer> {
  return buildXlsx(
    tables.map((t) => ({
      ...t,
      rows: t.rows.map((row) => row.map((v, i) => (typeof v === 'number' && t.columns[i]?.type === 'money' ? v / 100 : v))),
    })),
  );
}

function monthName(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function periodLabel(from?: string, to?: string) {
  if (!from && !to) return 'all time';
  if (from && from === to) return monthName(from);
  if (!to) return `from ${monthName(from!)}`;
  if (!from) return `up to ${monthName(to)}`;
  return `${monthName(from)} – ${monthName(to)}`;
}

function monthsFrom(start: string, end: string): string[] {
  const out: string[] = [];
  for (let m = start; m <= end; m = shiftMonthKey(m, 1)) {
    out.push(m);
    if (out.length > MAX_BUDGET_MONTHS) throw badRequest(`A budget export can cover at most ${MAX_BUDGET_MONTHS / 12} years. Pick a shorter range.`);
  }
  return out;
}

/** Months that have a plan (their own or carried over) within from..to; all time ends at this month or the last plan. */
async function budgetMonths(db: Collections, book: BookDoc, from?: string, to?: string): Promise<string[]> {
  const [first, last] = await Promise.all([
    db.budgets.find({ bookId: book._id }, { projection: { month: 1 } }).sort({ month: 1 }).limit(1).next(),
    db.budgets.find({ bookId: book._id }, { projection: { month: 1 } }).sort({ month: -1 }).limit(1).next(),
  ]);
  if (!first || !last) return [];
  const start = from && from > first.month ? from : first.month;
  const thisMonth = currentAppMonth();
  const end = to ?? (last.month > thisMonth ? last.month : thisMonth);
  return start <= end ? monthsFrom(start, end) : [];
}

/** A few months at a time, to stay within the database connection pool. */
async function computeBudgets(db: Collections, book: BookDoc, months: string[]): Promise<BudgetDTO[]> {
  const out: BudgetDTO[] = [];
  for (let i = 0; i < months.length; i += 4) {
    out.push(...(await Promise.all(months.slice(i, i + 4).map((m) => computeBudget(db, book, m)))));
  }
  return out.filter((b) => b.exists);
}

function headStatus(group: HeadGroup, planned: number, actual: number, paid: boolean): string {
  if (group === 'savings') return actual >= planned ? 'Saved' : actual > 0 ? 'Part saved' : 'To put aside';
  if (actual > planned) return 'Over budget';
  if (group === 'bills') return paid || (planned > 0 && actual >= planned) ? 'Paid' : actual > 0 ? 'Part paid' : 'To pay';
  return planned > 0 && actual === planned ? 'Fully used' : 'Within budget';
}

/** Plan vs actual per head (with an income row per month), and, for the whole budget, a summary per month. */
function budgetTables(
  budgets: BudgetDTO[],
  categories: Map<string, CategoryDoc>,
  order: HeadGroup[],
  categoryId?: string,
): { heads: Table; summary: Table | null } {
  const nameOf = (id: string) => categories.get(id)?.name ?? 'Unknown';
  const rank = (g: HeadGroup) => order.indexOf(g);
  const lineRows: Table['rows'] = [];
  for (const b of budgets) {
    if (!categoryId) {
      const received = b.totals.incomeReceived;
      lineRows.push([
        b.month,
        'Income',
        'Income',
        b.income,
        received,
        b.income - received,
        received >= b.income && received > 0 ? 'Received' : received > 0 ? 'Part received' : 'Not recorded',
      ]);
    }
    // Sections in the book's order; heads within a section in the plan's order.
    const lines = b.lines.filter((l) => !categoryId || l.categoryId === categoryId).sort((x, y) => rank(x.group) - rank(y.group));
    for (const l of lines) {
      lineRows.push([b.month, HEAD_GROUP_LABELS[l.group].name, nameOf(l.categoryId), l.planned, l.spent, l.remaining, headStatus(l.group, l.planned, l.spent, l.due?.paid ?? false)]);
    }
    const outside = b.unbudgeted.filter((u) => !categoryId || u.categoryId === categoryId).sort((x, y) => rank(x.group) - rank(y.group));
    for (const u of outside) {
      lineRows.push([b.month, HEAD_GROUP_LABELS[u.group].name, nameOf(u.categoryId), null, u.spent, null, 'Not in budget']);
    }
  }
  const heads: Table = {
    name: 'Budget',
    columns: [
      { header: 'Month', width: 10 },
      { header: 'Section', width: 11 },
      { header: 'Head', width: 24 },
      { header: 'Planned', type: 'money', width: 14 },
      { header: 'Actual', type: 'money', width: 14 },
      { header: 'Remaining', type: 'money', width: 14 },
      { header: 'Status', width: 14 },
    ],
    rows: lineRows,
  };
  if (categoryId) return { heads, summary: null };

  const planned = (b: BudgetDTO, g: HeadGroup) => b.lines.filter((l) => l.group === g).reduce((s, l) => s + l.planned, 0);
  const summary: Table = {
    name: 'Monthly summary',
    columns: [
      { header: 'Month', width: 10 },
      { header: 'Income planned', type: 'money', width: 15 },
      { header: 'Income received', type: 'money', width: 16 },
      ...order.map((g) => ({ header: `${HEAD_GROUP_LABELS[g].name} planned`, type: 'money' as const, width: 16 })),
      { header: 'Not given a job', type: 'money', width: 15 },
      { header: 'Spent', type: 'money', width: 14 },
      { header: 'Put aside', type: 'money', width: 14 },
      { header: 'Over budget', type: 'money', width: 14 },
      { header: 'Planned savings', type: 'money', width: 16 },
      { header: 'Saved (income − spent)', type: 'money', width: 22 },
    ],
    rows: budgets.map((b) => {
      const t = b.totals;
      const income = t.incomeReceived > 0 ? t.incomeReceived : b.income;
      return [b.month, b.income, t.incomeReceived, ...order.map((g) => planned(b, g)), t.unallocated, t.spent, t.saved, t.overspent, t.plannedSavings, income - t.spent];
    }),
  };
  return { heads, summary };
}

export const exportRoutes = new Hono<AppEnv>().get('/export', requirePermission('book.export'), async (c) => {
  const q = parse(exportQuerySchema, c.req.query());
  const format: ExportFormat = q.format ?? (q.what && q.what !== 'everything' ? 'csv' : 'json');
  const what: ExportKind = q.what ?? (format === 'csv' ? 'transactions' : 'everything');
  if (format === 'csv' && what === 'everything') throw badRequest('A CSV file holds one table. Export everything as Excel or JSON, or export the budget and transactions separately.');
  if (format === 'json' && what !== 'everything') throw badRequest('JSON is for a full backup. Pick CSV or Excel for the budget or transactions alone.');

  const db = c.get('db');
  const book = c.get('book');
  const order = normalizeGroupOrder(book.groupOrder);
  const { from, to, category: categoryId } = q;

  const categories = await db.categories.find({ bookId: book._id }).sort({ kind: 1, sort: 1 }).toArray();
  const categoryById = new Map(categories.map((cat) => [cat._id.toHexString(), cat]));
  const category = categoryId ? categoryById.get(categoryId) : undefined;
  if (categoryId && !category) throw notFound('Category not found');
  if (what === 'budget' && category?.kind === 'income') throw badRequest('Budget heads are expense categories. Pick an expense category, or export its transactions.');

  const wantsTransactions = what !== 'budget';
  const wantsBudget = what !== 'transactions';
  const date = { ...(from ? { $gte: `${from}-01` } : {}), ...(to ? { $lte: `${to}-31` } : {}) };

  const [transactions, members] = await Promise.all([
    wantsTransactions
      ? db.transactions
          .find({
            bookId: book._id,
            deletedAt: { $exists: false },
            ...(from || to ? { date } : {}),
            ...(category ? { categoryId: category._id } : {}),
          })
          .sort({ date: 1, createdAt: 1 })
          .toArray()
      : [],
    db.bookMembers.find({ bookId: book._id }).toArray(),
  ]);
  const names = await userNames(db, [...members.map((m) => m.userId), ...transactions.map((t) => t.createdBy)]);
  const nameOf = (id: ObjectId) => names.get(id.toHexString()) ?? 'Former member';
  const categoryName = (id: ObjectId) => categoryById.get(id.toHexString())?.name ?? '';
  const sectionOf = (cat: CategoryDoc | undefined) => (!cat ? '' : cat.kind === 'income' ? 'Income' : HEAD_GROUP_LABELS[headGroupOf(cat)].name);

  // The JSON backup stores plans as saved; spreadsheets show each month's plan against what happened.
  const savedPlans =
    wantsBudget && format === 'json'
      ? await db.budgets
          .find({ bookId: book._id, ...(from || to ? { month: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) })
          .sort({ month: 1 })
          .toArray()
      : [];
  const budgets = wantsBudget && format !== 'json' ? await computeBudgets(db, book, await budgetMonths(db, book, from, to)) : [];

  const label = what === 'budget' ? 'the budget' : what === 'transactions' ? 'transactions' : 'the book';
  await logActivity(db, {
    bookId: book._id,
    userId: c.get('userId'),
    action: 'export',
    entity: 'book',
    entityId: book._id,
    summary: `exported ${label}${category ? ` for ${category.name}` : ''} (${format === 'xlsx' ? 'Excel' : format.toUpperCase()}, ${periodLabel(from, to)}, ${
      what === 'budget' ? `${budgets.length} month${budgets.length === 1 ? '' : 's'}` : `${transactions.length} transactions`
    })`,
  });

  if (format === 'json') {
    return c.json({
      format: 'ffos-book-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: c.get('user').name,
      period: { from: from ?? null, to: to ?? null },
      ...(category ? { onlyCategory: category.name } : {}),
      book: { name: book.name, currency: book.currency, createdAt: book.createdAt.toISOString(), groupOrder: order },
      members: members.map((m) => ({ name: nameOf(m.userId), role: m.role, joinedAt: m.joinedAt.toISOString() })),
      categories: categories.map((cat) => ({ ...toCategoryDTO(cat), archived: cat.archived })),
      budgets: savedPlans.map((p) => ({
        month: p.month,
        income: p.income,
        lines: p.lines
          .filter((l) => !category || l.categoryId.equals(category._id))
          .map((l) => ({ categoryId: l.categoryId.toHexString(), category: categoryName(l.categoryId) || null, planned: l.planned })),
        carriedFrom: p.carriedFrom ?? null,
      })),
      transactions: transactions.map((t) => ({
        id: t._id.toHexString(),
        date: t.date,
        type: t.type,
        amountMinor: t.amount,
        amount: (t.amount / 100).toFixed(2),
        categoryId: t.categoryId.toHexString(),
        category: categoryName(t.categoryId) || null,
        note: t.note,
        addedBy: nameOf(t.createdBy),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  }

  // A workbook leads with the monthly summary; a budget CSV is the per-head table.
  const tables: Table[] = [];
  if (wantsBudget) {
    const { heads, summary } = budgetTables(budgets, categoryById, order, categoryId);
    if (summary && format === 'xlsx') tables.push(summary);
    tables.push(heads);
  }
  if (wantsTransactions) {
    tables.push({
      name: 'Transactions',
      columns: [
        { header: 'Date', type: 'date', width: 12 },
        { header: 'Type', width: 9 },
        { header: 'Category', width: 22 },
        { header: 'Section', width: 11 },
        { header: 'Amount', type: 'money', width: 14 },
        { header: 'Currency', width: 9 },
        { header: 'Note', width: 36 },
        { header: 'Added by', width: 16 },
        { header: 'Added at', width: 22 },
      ],
      rows: transactions.map((t) => [
        t.date,
        t.type,
        categoryName(t.categoryId),
        sectionOf(categoryById.get(t.categoryId.toHexString())),
        t.amount,
        book.currency,
        t.note,
        nameOf(t.createdBy),
        t.createdAt.toISOString(),
      ]),
    });
  }
  if (what === 'everything') {
    tables.push({
      name: 'Categories',
      columns: [
        { header: 'Name', width: 24 },
        { header: 'Kind', width: 9 },
        { header: 'Section', width: 11 },
        { header: 'Hidden', width: 8 },
        { header: 'Goal', type: 'money', width: 14 },
        { header: 'Goal by', width: 10 },
        { header: 'Allowance of', width: 16 },
      ],
      rows: categories
        .filter((cat) => !category || cat._id.equals(category._id))
        .map((cat) => [
          cat.name,
          cat.kind,
          sectionOf(cat),
          cat.archived ? 'Yes' : 'No',
          cat.goal?.target ?? null,
          cat.goal?.by ?? null,
          cat.memberId ? nameOf(cat.memberId) : null,
        ]),
    });
  }

  if (format === 'csv') return c.body(toCsv(tables[0]!), 200, { 'content-type': 'text/csv; charset=utf-8' });
  return c.body(toXlsx(tables), 200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
});
