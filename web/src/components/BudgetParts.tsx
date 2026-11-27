import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Check, CircleCheck, Plus, Settings2, Target } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  formatMoney,
  HEAD_GROUP_LABELS,
  toMinor,
  type BudgetDTO,
  type BudgetLineDTO,
  type CategoryDTO,
  type HeadGroup,
  type TransactionDTO,
} from '@ffos/shared';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import {
  leftLabel,
  lineStatus,
  movedLines,
  shortDay,
  statusBar,
  statusText,
  useMembers,
  useGroupOrder,
  usePayBill,
  useSavePlan,
  useUpdateHead,
  usedPct,
  type LineStatus,
} from '../lib/budget.ts';
import { currencySymbol, currentMonth, minorToInput, monthLabel, todayISO } from '../lib/format.ts';
import { TransactionRow, useOpenTransaction } from './AppShell.tsx';
import { useToast } from './Toast.tsx';
import { useCategories } from './TransactionSheet.tsx';
import { Button, ErrorBanner, inputClass, ProgressBar, Segmented, Sheet, Spinner } from './ui.tsx';

type Today = BudgetDTO['today'];

const labelTone: Record<LineStatus, string> = {
  ok: '',
  fast: 'text-warning',
  near: 'text-warning',
  over: 'text-negative',
  done: 'text-muted',
};

/** A thin bar with, for this month, a tick where spending "should" be by today. */
export function PaceBar({ pct, tone, today, className = 'h-1.5' }: { pct: number; tone: string; today?: Today; className?: string }) {
  return (
    <span className={`relative block ${className}`}>
      <ProgressBar className="h-full" pct={pct} tone={tone} />
      {today && (
        <span
          className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-ink/40"
          style={{ left: `${(today.day / today.daysInMonth) * 100}%` }}
          aria-hidden
        />
      )}
    </span>
  );
}

export function monthShort(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Two short lines per head, worded for its group: a spending bar with pace, a bill's due date, a goal's progress. */
export function HeadRow({
  line,
  category,
  ownerName,
  currency,
  today,
  onOpen,
  action,
}: {
  line: BudgetLineDTO;
  category?: CategoryDTO;
  /** Shown for personal heads (allowances). */
  ownerName?: string;
  currency: string;
  today?: Today;
  onOpen: () => void;
  /** e.g. a Pay button beside a bill. */
  action?: ReactNode;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const status = lineStatus(line, today);
  let detail: ReactNode;
  if (line.group === 'bills') {
    detail =
      status === 'done' ? (
        <span className="flex items-center gap-1 text-muted">
          <CircleCheck className="size-3.5 text-positive" /> {money(line.spent)}
        </span>
      ) : status === 'over' ? (
        <span className="text-negative">
          {money(line.spent)} paid of {money(line.planned)} planned
        </span>
      ) : (
        <span className={line.due && today && line.due.date < todayISO() ? 'text-warning' : statusText[status]}>
          {line.due
            ? today && line.due.date < todayISO()
              ? `Was due ${shortDay(line.due.date, todayISO())}`
              : `Due ${shortDay(line.due.date, todayISO())}`
            : `${money(line.planned)} planned`}
          {line.spent > 0 && ` · ${money(line.spent)} paid so far`}
        </span>
      );
  } else {
    detail = (
      <span className="flex items-center gap-2">
        <PaceBar
          className="h-1.5 flex-1"
          pct={usedPct(line)}
          tone={line.group === 'savings' ? (status === 'done' ? 'bg-positive' : 'bg-positive/70') : statusBar[status]}
          today={line.group === 'spending' ? today : undefined}
        />
        <span className={`w-20 shrink-0 text-right text-caption tabular ${statusText[status]}`}>of {money(line.planned)}</span>
      </span>
    );
  }

  return (
    <div className="flex items-center">
      <button onClick={onOpen} className="block min-w-0 flex-1 px-4 py-2 text-left hover:bg-subtle/60 active:bg-subtle">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-body font-medium">{category?.name ?? 'Unknown'}</span>
            {ownerName && <span className="shrink-0 text-caption text-muted">· {ownerName}</span>}
          </span>
          <span className={`shrink-0 text-label font-semibold tabular ${line.group === 'savings' && status === 'done' ? 'text-positive' : labelTone[status]}`}>
            {status === 'fast' ? 'Spending fast · ' : ''}
            {leftLabel(line, currency)}
          </span>
        </span>
        <span className="mt-1 block text-caption tabular">{detail}</span>
        {line.goal && (
          <span className="mt-1 flex items-center gap-1 text-caption text-muted tabular">
            <Target className="size-3.5 shrink-0" />
            <span className="truncate">
              {money(line.goal.saved)} of {money(line.goal.target)}
              {line.goal.saved >= line.goal.target
                ? ' · reached'
                : line.goal.monthlyNeeded !== null && line.goal.by
                  ? ` · ${money(line.goal.monthlyNeeded)}/mo · by ${monthShort(line.goal.by)}`
                  : ''}
            </span>
          </span>
        )}
      </button>
      {action}
    </div>
  );
}

/** Pay button for an unpaid bill that's set up as a monthly entry. */
export function PayButton({ line, month }: { line: BudgetLineDTO; month: string }) {
  const { book, can } = useCurrentBook();
  const toast = useToast();
  const categories = useCategories(book.id);
  const pay = usePayBill(book.id, month);
  // Only for the month in progress; a finished month's plan is history.
  if (!line.due || line.due.paid || !can('txn.create') || lineStatus(line) === 'done' || month !== currentMonth()) return null;
  const name = categories.data?.find((c) => c.id === line.categoryId)?.name ?? 'Bill';
  return (
    <button
      onClick={() =>
        pay.mutate(line.due!.recurringIds, {
          onSuccess: () => toast({ message: `${name} marked paid`, duration: 2500 }),
          onError: (err) => toast({ message: err instanceof Error ? err.message : "Couldn't mark it paid" }),
        })
      }
      disabled={pay.isPending}
      className="mr-3 flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-label font-medium hover:bg-subtle disabled:opacity-50"
    >
      {pay.isPending ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />} Paid
    </button>
  );
}

/** Tap a head: how it's going, what to do about it, and what was spent in it this month. */
export function HeadSheet({
  month,
  categoryId,
  budget,
  onClose,
  onMove,
  onSettings,
}: {
  month: string;
  categoryId: string | null;
  budget?: BudgetDTO;
  onClose: () => void;
  onMove: (categoryId: string) => void;
  onSettings: (categoryId: string) => void;
}) {
  const { book, can } = useCurrentBook();
  const toast = useToast();
  const openTransaction = useOpenTransaction();
  const categories = useCategories(book.id);
  const pay = usePayBill(book.id, month);
  const txns = useQuery({
    queryKey: ['book', book.id, 'transactions', month],
    queryFn: () => api.get<TransactionDTO[]>(`/books/${book.id}/transactions?month=${month}`),
    enabled: categoryId !== null,
  });
  if (!categoryId) return null;
  const category = categories.data?.find((c) => c.id === categoryId);
  const rows = (txns.data ?? []).filter((t) => t.categoryId === categoryId && t.type === 'expense');
  const line = budget?.lines.find((l) => l.categoryId === categoryId);
  const money = (n: number) => formatMoney(n, book.currency);
  const name = category?.name ?? 'this head';
  const status = line ? lineStatus(line, budget?.today) : null;
  const canPlan = can('budget.manage');
  const canAdd = can('txn.create');
  const remaining = line ? line.planned - line.spent : 0;

  const markPaid = () => {
    if (!line) return;
    if (line.due && !line.due.paid) {
      pay.mutate(line.due.recurringIds, {
        onSuccess: () => {
          toast({ message: `${name} marked paid`, duration: 2500 });
          onClose();
        },
      });
    } else {
      onClose();
      openTransaction(undefined, { categoryId, amount: remaining > 0 ? remaining : undefined });
    }
  };

  const actions: ReactNode[] = [];
  if (line?.group === 'bills' && status !== 'done' && status !== 'over' && canAdd) {
    actions.push(
      <Button key="pay" className="flex-1" loading={pay.isPending} onClick={markPaid}>
        <Check className="size-4" /> Mark paid
      </Button>,
    );
  }
  if (line?.group === 'savings' && remaining > 0 && canAdd) {
    actions.push(
      <Button
        key="save"
        className="flex-1"
        onClick={() => {
          onClose();
          openTransaction(undefined, { categoryId, amount: remaining });
        }}
      >
        <Plus className="size-4" /> Put aside {money(remaining)}
      </Button>,
    );
  }
  if (line && canPlan) {
    actions.push(
      <Button key="move" variant={actions.length ? 'secondary' : 'primary'} className="flex-1" onClick={() => onMove(categoryId)}>
        <ArrowRightLeft className="size-4" /> {status === 'over' ? `Cover ${money(-remaining)}` : 'Move money'}
      </Button>,
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={category?.name ?? 'Budget head'}
      heading={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-semibold">{category?.name ?? 'Budget head'}</span>
          {category && <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-caption text-muted">{HEAD_GROUP_LABELS[category.group].name}</span>}
        </span>
      }
    >
      {line && status && (
        <div className="mb-4">
          <p className={`text-title font-semibold tabular ${line.group === 'savings' && status === 'done' ? 'text-positive' : labelTone[status]}`}>
            {leftLabel(line, book.currency)}
          </p>
          <p className="text-label text-muted tabular">
            {line.group === 'savings' ? 'Put aside' : line.group === 'bills' ? 'Paid' : 'Spent'} {money(line.spent)} of {money(line.planned)}
            {line.due && !line.due.paid && ` · due ${shortDay(line.due.date, todayISO())}`}
          </p>
          {status === 'fast' && budget?.today && (
            <p className="mt-1 text-label text-warning">
              {Math.round(usedPct(line))}% used and {Math.round((budget.today.day / budget.today.daysInMonth) * 100)}% of the month gone.
            </p>
          )}
          {line.group === 'spending' && budget?.today && remaining > 0 && (
            <p className="mt-1 text-label text-muted tabular">
              About {money(Math.floor(remaining / budget.today.daysLeft / 100) * 100)} a day for the {budget.today.daysLeft} day
              {budget.today.daysLeft === 1 ? '' : 's'} left.
            </p>
          )}
          {line.goal && (
            <p className="mt-1 text-label text-muted tabular">
              Goal: {money(line.goal.saved)} of {money(line.goal.target)} saved
              {line.goal.monthlyNeeded !== null && line.goal.by && line.goal.saved < line.goal.target
                ? `. Put aside ${money(line.goal.monthlyNeeded)} a month to reach it by ${monthShort(line.goal.by)}.`
                : ''}
            </p>
          )}
        </div>
      )}
      {!line && (
        <p className="mb-4 text-label text-muted">
          Not in the {monthLabel(month)} plan.{canPlan && ' Add it as a head to track it.'}
        </p>
      )}

      {(actions.length > 0 || canPlan) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {actions}
          {canPlan && (
            <Button variant="secondary" onClick={() => onSettings(categoryId)} aria-label={`${name} settings`} title="Head settings">
              <Settings2 className="size-4" />
              {actions.length === 0 && 'Head settings'}
            </Button>
          )}
        </div>
      )}
      <ErrorBanner error={pay.error} />

      {txns.isLoading ? (
        <div className="grid h-24 place-items-center text-muted">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-label text-muted">Nothing recorded here in {monthLabel(month)}.</p>
      ) : (
        <div className="-mx-5 divide-y divide-line border-y border-line">
          {rows.map((t) => (
            <TransactionRow key={t.id} txn={t} category={category} currency={book.currency} showDate />
          ))}
        </div>
      )}
      {canAdd && (
        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            onClose();
            openTransaction(undefined, { categoryId });
          }}
        >
          <Plus className="size-4" /> Add to {name}
        </Button>
      )}
      <Link
        to={`/transactions?category=${categoryId}&scope=all`}
        className="mt-2 flex min-h-11 items-center justify-center rounded-lg text-label font-medium text-accent hover:bg-subtle"
      >
        See {name} in every month
      </Link>
    </Sheet>
  );
}

const UNASSIGNED = '__unassigned';

/**
 * Move part of the plan between heads, e.g. cover an overspend in Milk from what's left in Fuel.
 * "Not assigned" is income no head has, so taking from it lowers what's saved.
 */
export function MoveMoneySheet({ month, budget, categoryId, onClose }: { month: string; budget?: BudgetDTO; categoryId: string | null; onClose: () => void }) {
  const { book } = useCurrentBook();
  const toast = useToast();
  const categories = useCategories(book.id);
  const save = useSavePlan(book.id, month);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const money = (n: number) => formatMoney(n, book.currency);
  const nameOf = (id: string) => (id === UNASSIGNED ? 'Not assigned' : (categories.data?.find((c) => c.id === id)?.name ?? 'Unknown'));

  // Start each time it opens: covering an overspend, from the head with the most left.
  useEffect(() => {
    if (!categoryId || !budget) return;
    save.reset();
    const target = budget.lines.find((l) => l.categoryId === categoryId);
    const over = target ? Math.max(0, target.spent - target.planned) : 0;
    const best = budget.lines
      .filter((l) => l.categoryId !== categoryId && l.group === 'spending' && l.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)[0];
    setTo(categoryId);
    setFrom(budget.totals.unallocated >= Math.max(over, 1) || !best ? UNASSIGNED : best.categoryId);
    setAmount(over ? minorToInput(over) : '');
  }, [categoryId]);

  if (!categoryId || !budget) return null;
  const minor = toMinor(amount || '0');
  const source = budget.lines.find((l) => l.categoryId === from);
  const available = from === UNASSIGNED ? Math.max(0, budget.totals.unallocated) : (source?.planned ?? 0);
  const tooMuch = minor !== null && minor > available && from !== UNASSIGNED;
  const sourceGoesOver = source && minor !== null && source.planned - minor < source.spent;
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  const option = (id: string) => {
    if (id === UNASSIGNED) return `Not assigned (${money(Math.max(0, budget.totals.unallocated))})`;
    const l = budget.lines.find((x) => x.categoryId === id)!;
    return `${nameOf(id)} · ${leftLabel(l, book.currency)}`;
  };
  const ids = [UNASSIGNED, ...budget.lines.map((l) => l.categoryId)];

  return (
    <Sheet
      open
      onClose={onClose}
      title="Move money"
      footer={
        <>
          <ErrorBanner error={save.error} />
          <Button
            className="w-full"
            disabled={!minor || minor <= 0 || from === to || tooMuch || conflict}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { budget, lines: movedLines(budget, from === UNASSIGNED ? null : from, to === UNASSIGNED ? null : to, minor!) },
                {
                  onSuccess: () => {
                    toast({ message: `Moved ${money(minor!)} from ${nameOf(from)} to ${nameOf(to)}`, duration: 3000 });
                    onClose();
                  },
                },
              )
            }
          >
            Move {minor ? money(minor) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-label font-medium">Amount</span>
          <span className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-title text-muted">{currencySymbol(book.currency)}</span>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              className={`${inputClass} min-h-12 pl-8 text-title font-semibold tabular`}
              aria-invalid={minor === null || tooMuch}
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-label font-medium">From</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
            {ids.filter((id) => id !== to).map((id) => (
              <option key={id} value={id}>
                {option(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-label font-medium">To</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
            {ids.filter((id) => id !== from).map((id) => (
              <option key={id} value={id}>
                {option(id)}
              </option>
            ))}
          </select>
        </label>
        {tooMuch && <p className="text-label text-negative">{nameOf(from)} only has {money(available)} planned.</p>}
        {!tooMuch && sourceGoesOver && (
          <p className="text-label text-warning">{nameOf(from)} has already spent more than that leaves, so it will show as over.</p>
        )}
        {from === UNASSIGNED && minor !== null && minor > Math.max(0, budget.totals.unallocated) && (
          <p className="text-label text-warning">That's more than the income not assigned yet, so the plan will be more than your income.</p>
        )}
        <p className="text-caption text-muted">Changes this month's plan only. Moving from "Not assigned" lowers what you save.</p>
      </div>
    </Sheet>
  );
}

/** A head's group, whose allowance it is, and (for savings) what it's saving up for. */
export function HeadSettingsSheet({ categoryId, onClose }: { categoryId: string | null; onClose: () => void }) {
  const { book } = useCurrentBook();
  const { user } = useAuth();
  const toast = useToast();
  const categories = useCategories(book.id);
  const members = useMembers(book.id, categoryId !== null && book.memberCount > 1);
  const update = useUpdateHead(book.id);
  const groupOrder = useGroupOrder();
  const category = categories.data?.find((c) => c.id === categoryId);
  const [group, setGroup] = useState<HeadGroup>('spending');
  const [memberId, setMemberId] = useState('');
  const [hasGoal, setHasGoal] = useState(false);
  const [target, setTarget] = useState('');
  const [by, setBy] = useState('');
  const [start, setStart] = useState('');

  useEffect(() => {
    if (!category) return;
    update.reset();
    setGroup(category.group);
    setMemberId(category.memberId ?? '');
    setHasGoal(category.goal !== null);
    setTarget(minorToInput(category.goal?.target ?? 0));
    setBy(category.goal?.by ?? '');
    setStart(minorToInput(category.goal?.start ?? 0));
  }, [categoryId, category?.id]);

  if (!categoryId || !category) return null;
  const targetMinor = toMinor(target || '0');
  const startMinor = toMinor(start || '0');
  const goalInvalid = group === 'savings' && hasGoal && (!targetMinor || targetMinor <= 0 || startMinor === null);

  const submit = () => {
    const goal =
      group === 'savings' && hasGoal ? { target: targetMinor!, by: by || null, start: startMinor ?? 0 } : category.goal ? null : undefined;
    update.mutate(
      {
        id: category.id,
        ...(group !== category.group ? { group } : {}),
        ...((memberId || null) !== category.memberId ? { memberId: memberId || null } : {}),
        ...(goal !== undefined ? { goal } : {}),
      },
      {
        onSuccess: () => {
          toast({ message: `${category.name} updated`, duration: 2000 });
          onClose();
        },
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${category.name} settings`}
      footer={
        <>
          <ErrorBanner error={update.error} />
          <Button className="w-full" disabled={goalInvalid} loading={update.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-1.5 text-label font-medium">What kind of head is {category.name}?</p>
          <Segmented value={group} onChange={setGroup} options={groupOrder.map((g) => ({ value: g, label: HEAD_GROUP_LABELS[g].name }))} />
          <p className="mt-1.5 text-caption text-muted">{HEAD_GROUP_LABELS[group].description}</p>
        </div>

        {book.memberCount > 1 && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Whose is it?</span>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={inputClass}>
              <option value="">Shared by everyone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.userId === user?.id ? ' (you)' : ''}'s allowance
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-caption text-muted">A personal allowance shows first for that person and on their Overview.</span>
          </label>
        )}

        {group === 'savings' && (
          <div className="space-y-3">
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-label font-medium">Saving up for a target</span>
              <input type="checkbox" checked={hasGoal} onChange={(e) => setHasGoal(e.target.checked)} className="size-5 accent-[var(--app-primary)]" />
            </label>
            {hasGoal && (
              <>
                <MoneyField label="Target" value={target} onChange={setTarget} currency={book.currency} invalid={targetMinor === null} />
                <label className="block">
                  <span className="mb-1.5 block text-label font-medium">By (optional)</span>
                  <input type="month" value={by} onChange={(e) => setBy(e.target.value)} className={inputClass} />
                </label>
                <MoneyField label="Already saved before" value={start} onChange={setStart} currency={book.currency} invalid={startMinor === null} />
                <p className="text-caption text-muted">Progress counts everything put into {category.name}, plus what was saved before.</p>
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function MoneyField({ label, value, onChange, currency, invalid }: { label: string; value: string; onChange: (v: string) => void; currency: string; invalid?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label font-medium">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">{currencySymbol(currency)}</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          className={`${inputClass} pl-8 tabular`}
        />
      </span>
    </label>
  );
}

/** The headline for this month: what can be spent today without going over, and how the month is going. */
export function SafeToSpend({ budget, currency }: { budget: BudgetDTO; currency: string }) {
  const money = (n: number) => formatMoney(n, currency);
  const t = budget.today!;
  const spending = budget.lines.filter((l) => l.group === 'spending');
  const planned = spending.reduce((s, l) => s + l.planned, 0);
  const spent = spending.reduce((s, l) => s + l.spent, 0);
  const pct = planned ? Math.min(100, (spent / planned) * 100) : 0;
  const ahead = planned > 0 && spent / planned > t.day / t.daysInMonth + 0.1;
  return (
    <div>
      <p className="text-label font-medium text-muted">Safe to spend today</p>
      <p className={`text-display font-semibold tracking-tight tabular ${t.safePerDay === 0 ? 'text-negative' : ''}`}>{money(t.safePerDay)}</p>
      <p className="mt-0.5 text-label text-muted tabular">
        {money(t.spendingLeft)} left for day-to-day spending · {t.daysLeft} day{t.daysLeft === 1 ? '' : 's'} left
      </p>
      {planned > 0 && (
        <>
          <PaceBar className="mt-3 h-2" pct={pct} tone={spent > planned ? 'bg-negative' : ahead ? 'bg-warning' : 'bg-primary'} today={t} />
          <p className="mt-1.5 text-caption text-muted tabular">
            Spent {money(spent)} of {money(planned)}
            {ahead ? ' · ahead of the month' : ' · on pace'}
          </p>
        </>
      )}
    </div>
  );
}

