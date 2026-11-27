import type { ObjectId } from 'mongodb';
import {
  currentPeriod,
  formatMoney,
  isDueIn,
  occurrenceIn,
  shiftDate,
  todayIn,
  type BudgetDTO,
} from '@ffos/shared';
import type { BookDoc, Collections } from '../db.ts';
import { computeBudget } from '../routes/budget.ts';
import { monthRange } from '../routes/ledger.ts';
import { calendarOf } from './books.ts';
import { sendPush, vapidKeys, type PushMessage, type PushTarget, type VapidKeys } from './push.ts';

// The daily reminder run (a scheduled function, 9:00 India time): for everyone who turned notifications
// on, one notification per book about bills due today or tomorrow and spending categories that are
// nearly used up or over. Each reminder is sent once.

const LOG_DAYS = 45;

/** Lines like "Rent due tomorrow · ₹15,000" for one book, and the keys that mark them sent. */
async function remindersFor(db: Collections, book: BookDoc, wants: { bills: boolean; budget: boolean }, budgetFor: (book: BookDoc) => Promise<BudgetDTO>) {
  const calendar = calendarOf(book);
  const today = todayIn(calendar.timeZone);
  const tomorrow = shiftDate(today, 1);
  const month = currentPeriod(calendar);
  const money = (n: number) => formatMoney(n, book.currency);
  const items: { key: string; text: string }[] = [];

  if (wants.bills) {
    const rules = (await db.recurring.find({ bookId: book._id, type: 'expense', active: true, startMonth: { $lte: month }, skippedMonths: { $ne: month } }).toArray()).filter((r) =>
      isDueIn(r, month),
    );
    const due = rules
      .map((r) => ({ rule: r, date: occurrenceIn(month, r.dayOfMonth, calendar.startDay) }))
      .filter((d) => d.date === today || d.date === tomorrow);
    if (due.length) {
      const added = new Set(
        (
          await db.transactions.distinct('recurringId', {
            bookId: book._id,
            recurringId: { $in: due.map((d) => d.rule._id) },
            deletedAt: { $exists: false },
            date: monthRange(month, calendar.startDay),
          })
        ).map((id) => (id as ObjectId).toHexString()),
      );
      const names = new Map(
        (await db.categories.find({ _id: { $in: due.map((d) => d.rule.categoryId) } }, { projection: { name: 1 } }).toArray()).map((c) => [c._id.toHexString(), c.name]),
      );
      for (const d of due) {
        if (added.has(d.rule._id.toHexString())) continue;
        const name = d.rule.note || names.get(d.rule.categoryId.toHexString()) || 'A bill';
        items.push({ key: `due:${d.rule._id.toHexString()}:${month}`, text: `${name} due ${d.date === today ? 'today' : 'tomorrow'} · ${money(d.rule.amount)}` });
      }
    }
  }

  if (wants.budget) {
    const budget = await budgetFor(book);
    const near = (book.alertAt ?? 80) / 100;
    const names = new Map(
      (await db.categories.find({ bookId: book._id, kind: 'expense' }, { projection: { name: 1 } }).toArray()).map((c) => [c._id.toHexString(), c.name]),
    );
    for (const l of budget.lines) {
      if (l.group !== 'spending') continue;
      const limit = l.planned + l.rolloverIn;
      const name = names.get(l.categoryId) ?? 'A category';
      if (limit >= 0 && l.spent > limit) items.push({ key: `over:${l.categoryId}:${month}`, text: `${name} is ${money(l.spent - limit)} over budget` });
      else if (limit > 0 && l.spent >= limit * near) items.push({ key: `near:${l.categoryId}:${month}`, text: `${name}: ${money(limit - l.spent)} left` });
    }
  }
  return items;
}

export interface ReminderRun {
  users: number;
  notifications: number;
  removedSubscriptions: number;
}

/** One reminder run. `send` is replaceable for tests. */
export async function sendDailyReminders(
  db: Collections,
  send: (target: PushTarget, message: PushMessage, keys: VapidKeys) => Promise<'sent' | 'gone' | 'failed'> = sendPush,
  keys: VapidKeys | null = vapidKeys(),
): Promise<ReminderRun> {
  const run: ReminderRun = { users: 0, notifications: 0, removedSubscriptions: 0 };
  if (!keys) return run;
  const subscriptions = await db.pushSubscriptions.find().toArray();
  const byUser = new Map<string, typeof subscriptions>();
  for (const s of subscriptions) byUser.set(s.userId.toHexString(), [...(byUser.get(s.userId.toHexString()) ?? []), s]);

  // A book's budget is the same for every member, so it's worked out once per run.
  const budgets = new Map<string, Promise<BudgetDTO>>();
  const budgetFor = (book: BookDoc) => {
    const id = book._id.toHexString();
    if (!budgets.has(id)) budgets.set(id, computeBudget(db, book, currentPeriod(calendarOf(book))));
    return budgets.get(id)!;
  };

  for (const [userId, subs] of byUser) {
    const user = await db.users.findOne({ _id: subs[0]!.userId, disabledAt: { $exists: false } }, { projection: { notify: 1 } });
    if (!user) continue;
    const wants = { bills: user.notify?.bills ?? true, budget: user.notify?.budget ?? true };
    if (!wants.bills && !wants.budget) continue;
    run.users++;
    const memberships = await db.bookMembers.find({ userId: user._id, role: { $ne: 'viewer' } }).toArray();
    const books = await db.books.find({ _id: { $in: memberships.map((m) => m.bookId) }, deletedAt: { $exists: false } }).toArray();
    for (const book of books) {
      const items = await remindersFor(db, book, wants, budgetFor);
      if (!items.length) continue;
      const keysToLog = items.map((i) => `${userId}:${i.key}`);
      const already = new Set((await db.pushLog.find({ _id: { $in: keysToLog } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
      const fresh = items.filter((i) => !already.has(`${userId}:${i.key}`));
      if (!fresh.length) continue;
      const message: PushMessage = {
        title: book.name,
        body: fresh.slice(0, 3).map((i) => i.text).join('\n') + (fresh.length > 3 ? `\n+${fresh.length - 3} more` : ''),
        url: fresh.some((i) => !i.key.startsWith('due:')) ? '#/budget' : '#/',
        tag: `ffos-${book._id.toHexString()}`,
      };
      let delivered = false;
      for (const sub of subs) {
        const result = await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, message, keys);
        if (result === 'gone') {
          await db.pushSubscriptions.deleteOne({ _id: sub._id });
          run.removedSubscriptions++;
        }
        if (result === 'sent') delivered = true;
      }
      if (delivered) {
        run.notifications++;
        const expiresAt = new Date(Date.now() + LOG_DAYS * 86_400_000);
        await db.pushLog.insertMany(fresh.map((i) => ({ _id: `${userId}:${i.key}`, expiresAt })), { ordered: false }).catch(() => undefined);
      }
    }
  }
  return run;
}
