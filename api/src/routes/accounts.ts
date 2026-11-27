import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import {
  accountCreateSchema,
  accountUpdateSchema,
  canModifyRecord,
  formatMoney,
  todayIn,
  transferCreateSchema,
  type AccountDTO,
  type TransferDTO,
} from '@ffos/shared';
import type { AppEnv } from '../context.ts';
import type { AccountDoc, BookDoc, Collections, TransferDoc } from '../db.ts';
import { calendarOf, diff, logActivity } from '../lib/books.ts';
import { badRequest, forbidden, notFound, oid, parse } from '../lib/errors.ts';
import { requirePermission } from '../middleware/book.ts';
import { userNames } from './ledger.ts';

// Mounted under /books/:bookId after requireBook. Accounts are where the money sits (cash, bank, card,
// UPI wallet, loan). An entry can say which account it was paid from; transfers move money between two
// accounts without counting as income or spending. Balances run from each account's opening balance.

/** Balances up to today: opening balance, plus money in, minus money out, from the opening date on. */
export async function accountBalances(db: Collections, book: BookDoc, accounts: AccountDoc[]) {
  const out = new Map<string, { balance: number; entries: number }>();
  if (!accounts.length) return out;
  const today = todayIn(calendarOf(book).timeZone);
  const ids = accounts.map((a) => a._id);
  const live = { bookId: book._id, deletedAt: { $exists: false }, date: { $lte: today } };
  const [entries, outgoing, incoming] = await Promise.all([
    // Per account, type and day, so each account's own opening date can be applied below.
    db.transactions
      .aggregate<{ _id: { account: ObjectId; type: 'income' | 'expense'; date: string }; total: number; n: number }>([
        { $match: { ...live, accountId: { $in: ids } } },
        { $group: { _id: { account: '$accountId', type: '$type', date: '$date' }, total: { $sum: '$amount' }, n: { $sum: 1 } } },
      ])
      .toArray(),
    db.transfers.find({ ...live, fromAccountId: { $in: ids } }, { projection: { fromAccountId: 1, amount: 1, date: 1 } }).toArray(),
    db.transfers.find({ ...live, toAccountId: { $in: ids } }, { projection: { toAccountId: 1, amount: 1, date: 1 } }).toArray(),
  ]);
  for (const a of accounts) {
    const id = a._id.toHexString();
    // Anything before the opening date is already in the opening balance.
    const after = (date: string) => date >= a.openingDate;
    let balance = a.openingBalance;
    let n = 0;
    for (const e of entries) {
      if (!e._id.account.equals(a._id) || !after(e._id.date)) continue;
      balance += e._id.type === 'income' ? e.total : -e.total;
      n += e.n;
    }
    for (const t of outgoing) if (t.fromAccountId.equals(a._id) && after(t.date)) (balance -= t.amount), n++;
    for (const t of incoming) if (t.toAccountId.equals(a._id) && after(t.date)) (balance += t.amount), n++;
    out.set(id, { balance, entries: n });
  }
  return out;
}

async function toAccountDTOs(db: Collections, book: BookDoc, accounts: AccountDoc[]): Promise<AccountDTO[]> {
  const balances = await accountBalances(db, book, accounts);
  return accounts.map((a) => ({
    id: a._id.toHexString(),
    name: a.name,
    kind: a.kind,
    openingBalance: a.openingBalance,
    openingDate: a.openingDate,
    archived: a.archived,
    balance: balances.get(a._id.toHexString())?.balance ?? a.openingBalance,
    entries: balances.get(a._id.toHexString())?.entries ?? 0,
  }));
}

async function toTransferDTOs(db: Collections, docs: TransferDoc[]): Promise<TransferDTO[]> {
  const names = await userNames(db, docs.map((d) => d.createdBy));
  return docs.map((t) => ({
    id: t._id.toHexString(),
    fromAccountId: t.fromAccountId.toHexString(),
    toAccountId: t.toAccountId.toHexString(),
    amount: t.amount,
    date: t.date,
    note: t.note,
    createdBy: t.createdBy.toHexString(),
    createdByName: names.get(t.createdBy.toHexString()) ?? 'Former member',
  }));
}

/** An account of this book that's still in use. */
export async function assertAccount(db: Collections, bookId: ObjectId, id: string) {
  const account = await db.accounts.findOne({ _id: new ObjectId(id), bookId, archived: false });
  if (!account) throw badRequest('Account not found', { accountId: 'Account not found' });
  return account;
}

export const accountRoutes = new Hono<AppEnv>()
  .get('/accounts', async (c) => {
    const db = c.get('db');
    const book = c.get('book');
    const accounts = await db.accounts.find({ bookId: book._id }).sort({ sort: 1, createdAt: 1 }).toArray();
    return c.json(await toAccountDTOs(db, book, accounts));
  })

  .post('/accounts', requirePermission('plan.manage'), async (c) => {
    const input = parse(accountCreateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const now = new Date();
    const count = await db.accounts.countDocuments({ bookId: book._id });
    if (count >= 30) throw badRequest('A book can have at most 30 accounts');
    const doc: AccountDoc = {
      _id: new ObjectId(),
      bookId: book._id,
      ...input,
      archived: false,
      sort: count,
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.accounts.insertOne(doc);
    await logActivity(db, { bookId: book._id, userId: c.get('userId'), action: 'create', entity: 'book', entityId: doc._id, summary: `added the account "${doc.name}"` });
    const [dto] = await toAccountDTOs(db, book, [doc]);
    return c.json(dto, 201);
  })

  .patch('/accounts/:id', requirePermission('plan.manage'), async (c) => {
    const input = parse(accountUpdateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const existing = await db.accounts.findOne({ _id: oid(c.req.param('id')), bookId: book._id });
    if (!existing) throw notFound('Account not found');
    const changed = diff(existing, input);
    if (Object.keys(changed).length) {
      await db.accounts.updateOne({ _id: existing._id }, { $set: { ...input, updatedBy: c.get('userId'), updatedAt: new Date() }, $inc: { version: 1 } });
      await logActivity(db, {
        bookId: book._id,
        userId: c.get('userId'),
        action: 'update',
        entity: 'book',
        entityId: existing._id,
        summary: input.archived === true ? `closed the account "${existing.name}"` : `edited the account "${existing.name}" (${Object.keys(changed).join(', ')})`,
        diff: changed,
      });
    }
    const updated = (await db.accounts.findOne({ _id: existing._id }))!;
    const [dto] = await toAccountDTOs(db, book, [updated]);
    return c.json(dto);
  })

  // Only an account nothing points at can be deleted; one that's been used can be closed (archived).
  .delete('/accounts/:id', requirePermission('plan.manage'), async (c) => {
    const db = c.get('db');
    const book = c.get('book');
    const account = await db.accounts.findOne({ _id: oid(c.req.param('id')), bookId: book._id });
    if (!account) throw notFound('Account not found');
    const [entries, transfers] = await Promise.all([
      db.transactions.countDocuments({ bookId: book._id, accountId: account._id }),
      db.transfers.countDocuments({ bookId: book._id, $or: [{ fromAccountId: account._id }, { toAccountId: account._id }] }),
    ]);
    if (entries || transfers) throw badRequest(`"${account.name}" has ${entries + transfers} entr${entries + transfers === 1 ? 'y' : 'ies'}. Close it instead; its history stays.`);
    await db.accounts.deleteOne({ _id: account._id });
    await logActivity(db, { bookId: book._id, userId: c.get('userId'), action: 'delete', entity: 'book', entityId: account._id, summary: `deleted the account "${account.name}"` });
    return c.body(null, 204);
  })

  // Transfers, newest first; ?account= for one account's.
  .get('/transfers', async (c) => {
    const db = c.get('db');
    const accountId = c.req.query('account');
    const filter: Record<string, unknown> = { bookId: c.get('book')._id, deletedAt: { $exists: false } };
    if (accountId) {
      const id = oid(accountId);
      filter.$or = [{ fromAccountId: id }, { toAccountId: id }];
    }
    const rows = await db.transfers.find(filter).sort({ date: -1, createdAt: -1 }).limit(200).toArray();
    return c.json(await toTransferDTOs(db, rows));
  })

  .post('/transfers', requirePermission('txn.create'), async (c) => {
    const input = parse(transferCreateSchema, await c.req.json());
    const db = c.get('db');
    const book = c.get('book');
    const [from, to] = await Promise.all([assertAccount(db, book._id, input.fromAccountId), assertAccount(db, book._id, input.toAccountId)]);
    const now = new Date();
    const doc: TransferDoc = {
      _id: new ObjectId(),
      bookId: book._id,
      fromAccountId: from._id,
      toAccountId: to._id,
      amount: input.amount,
      date: input.date,
      note: input.note,
      createdBy: c.get('userId'),
      updatedBy: c.get('userId'),
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.transfers.insertOne(doc);
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'create',
      entity: 'transaction',
      entityId: doc._id,
      summary: `moved ${formatMoney(doc.amount, book.currency)} from ${from.name} to ${to.name}`,
    });
    const [dto] = await toTransferDTOs(db, [doc]);
    return c.json(dto, 201);
  })

  .delete('/transfers/:id', async (c) => {
    const db = c.get('db');
    const book = c.get('book');
    const transfer = await db.transfers.findOne({ _id: oid(c.req.param('id')), bookId: book._id });
    if (!transfer) throw notFound('Transfer not found');
    if (!canModifyRecord(c.get('role'), 'delete', transfer.createdBy.toHexString(), c.get('userId').toHexString())) {
      throw forbidden('You can only remove transfers you added');
    }
    await db.transfers.deleteOne({ _id: transfer._id });
    await logActivity(db, {
      bookId: book._id,
      userId: c.get('userId'),
      action: 'delete',
      entity: 'transaction',
      entityId: transfer._id,
      summary: `removed a transfer of ${formatMoney(transfer.amount, book.currency)}`,
    });
    return c.body(null, 204);
  });
