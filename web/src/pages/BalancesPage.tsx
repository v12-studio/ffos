import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, Banknote, CreditCard, Landmark, Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ACCOUNT_KIND_LABELS, ACCOUNT_KINDS, canModifyRecord, formatMoney, toMinor, type AccountDTO, type AccountKind, type TransferDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, EmptyState, ErrorBanner, Field, fieldErrors, inputClass, PageSkeleton, SectionTitle, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAccounts } from '../lib/accounts.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { dayLabel, minorToInput, todayISO } from '../lib/format.ts';

export const KIND_ICON: Record<AccountKind, typeof Wallet> = { cash: Banknote, bank: Landmark, card: CreditCard, wallet: Wallet, loan: Landmark, other: Wallet };

/** Where the money is: each account's balance, the total, and money moved between them. */
export function BalancesPage() {
  const { book, can } = useCurrentBook();
  const accounts = useAccounts(book.id);
  const [editing, setEditing] = useState<AccountDTO | 'new' | null>(null);
  const [moving, setMoving] = useState(false);
  const list = accounts.data ?? [];
  const open = list.filter((a) => !a.archived);
  const closed = list.filter((a) => a.archived);
  const total = open.reduce((s, a) => s + a.balance, 0);
  const money = (n: number) => formatMoney(n, book.currency);
  const transfers = useQuery({
    queryKey: ['book', book.id, 'transfers'],
    queryFn: () => api.get<TransferDTO[]>(`/books/${book.id}/transfers`),
    enabled: list.length > 1,
  });
  const nameOf = (id: string) => list.find((a) => a.id === id)?.name ?? 'Closed account';

  const row = (a: AccountDTO) => {
    const Icon = KIND_ICON[a.kind];
    return (
      <button key={a.id} onClick={() => setEditing(a)} disabled={!can('plan.manage')} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60 disabled:hover:bg-transparent">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted">
          <Icon className="size-4.5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body font-medium ${a.archived ? 'text-muted' : ''}`}>{a.name}</span>
          <span className="block truncate text-caption text-muted">{ACCOUNT_KIND_LABELS[a.kind]}</span>
        </span>
        <span className={`shrink-0 text-body font-semibold tabular ${a.balance < 0 ? 'text-negative' : ''}`}>
          {a.balance < 0 ? '−' : ''}
          {money(Math.abs(a.balance))}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <Link to="/more" className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-label font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageTitle
        subtitle="Cash, bank, cards and wallets. Pick one when adding an entry and its balance stays up to date."
        action={
          can('plan.manage') && (
            <Button className="min-h-9! shrink-0 px-3 text-label" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add
            </Button>
          )
        }
      >
        Accounts & balances
      </PageTitle>
      <ErrorBanner error={accounts.error} />
      {accounts.isLoading ? (
        <PageSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet className="size-5" />} title="No accounts yet">
            Add your cash, bank accounts and cards with what's in them today. Then choose one when adding an entry (the sliders button) and balances follow.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <p className="text-label font-medium text-muted">Total across accounts</p>
            <p className={`text-display font-semibold tracking-tight tabular ${total < 0 ? 'text-negative' : ''}`}>
              {total < 0 ? '−' : ''}
              {money(Math.abs(total))}
            </p>
            <p className="mt-0.5 text-caption text-muted">Card and loan balances below zero are money owed, and count against the total.</p>
            {open.length > 1 && can('txn.create') && (
              <Button variant="secondary" className="mt-3 w-full" onClick={() => setMoving(true)}>
                <ArrowRightLeft className="size-4" /> Move money between accounts
              </Button>
            )}
          </Card>
          <section>
            <SectionTitle>Accounts</SectionTitle>
            <Card className="divide-y divide-line overflow-hidden">{open.map(row)}</Card>
          </section>
          {closed.length > 0 && (
            <section>
              <SectionTitle>Closed</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">{closed.map(row)}</Card>
            </section>
          )}
          {(transfers.data?.length ?? 0) > 0 && (
            <section>
              <SectionTitle>Money moved</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {transfers.data!.slice(0, 30).map((t) => (
                  <TransferRow key={t.id} transfer={t} from={nameOf(t.fromAccountId)} to={nameOf(t.toAccountId)} />
                ))}
              </Card>
            </section>
          )}
        </>
      )}
      <AccountSheet editing={editing} onClose={() => setEditing(null)} key={editing === 'new' ? 'new' : (editing?.id ?? 'none')} />
      <TransferSheet open={moving} accounts={open} onClose={() => setMoving(false)} />
    </div>
  );
}

function TransferRow({ transfer: t, from, to }: { transfer: TransferDTO; from: string; to: string }) {
  const { book } = useCurrentBook();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: () => api.del(`/books/${book.id}/transfers/${t.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'transfers'] });
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'accounts'] });
    },
  });
  const canRemove = canModifyRecord(book.role, 'delete', t.createdBy, user!.id);
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <ArrowRightLeft className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-medium">
          {from} → {to}
        </span>
        <span className="block truncate text-caption text-muted">
          {[dayLabel(t.date), t.note, book.memberCount > 1 ? `by ${t.createdByName}` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-label font-medium tabular">{formatMoney(t.amount, book.currency)}</span>
      {canRemove && (
        <button
          onClick={async () => {
            if (await confirm({ title: 'Remove this transfer?', message: 'Both balances go back to how they were.', confirmLabel: 'Remove', danger: true })) remove.mutate();
          }}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
          aria-label="Remove transfer"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}

function AccountSheet({ editing, onClose }: { editing: AccountDTO | 'new' | null; onClose: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = editing && editing !== 'new' ? editing : null;
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    kind: existing?.kind ?? ('bank' as AccountKind),
    // Shown as a positive amount plus "owed" for cards and loans, which is how people think of them.
    opening: existing ? minorToInput(Math.abs(existing.openingBalance)) : '',
    owed: existing ? existing.openingBalance < 0 : false,
    openingDate: existing?.openingDate ?? todayISO(),
  });
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['book', book.id, 'accounts'] });
    onClose();
  };
  const openingMinor = toMinor(form.opening || '0');
  const body = () => ({ name: form.name, kind: form.kind, openingBalance: (openingMinor ?? 0) * (form.owed ? -1 : 1), openingDate: form.openingDate });
  const save = useMutation({
    mutationFn: () => (existing ? api.patch(`/books/${book.id}/accounts/${existing.id}`, body()) : api.post(`/books/${book.id}/accounts`, body())),
    onSuccess: done,
  });
  const close = useMutation({ mutationFn: () => api.patch(`/books/${book.id}/accounts/${existing!.id}`, { archived: !existing!.archived }), onSuccess: done });
  const remove = useMutation({
    mutationFn: () => api.del(`/books/${book.id}/accounts/${existing!.id}`),
    onSuccess: () => {
      toast({ message: `${existing!.name} deleted`, duration: 2000 });
      done();
    },
  });
  const errors = fieldErrors(save.error);
  if (!editing) return null;
  const owedKind = form.kind === 'card' || form.kind === 'loan';

  return (
    <Sheet open onClose={onClose} title={existing ? `Edit ${existing.name}` : 'New account'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" value={form.name} maxLength={40} placeholder="e.g. SBI savings, Cash, HDFC card" error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={!existing} />
        <label className="block">
          <span className="mb-1.5 block text-label font-medium">Kind</span>
          <select
            value={form.kind}
            onChange={(e) => {
              const kind = e.target.value as AccountKind;
              setForm({ ...form, kind, owed: kind === 'card' || kind === 'loan' ? true : form.owed && form.kind !== 'card' && form.kind !== 'loan' });
            }}
            className={inputClass}
          >
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={owedKind ? 'Owed on' : 'Balance on'} type="date" value={form.openingDate} onChange={(e) => setForm({ ...form, openingDate: e.target.value })} />
          <Field label="Amount" inputMode="decimal" placeholder="0" value={form.opening} error={errors.openingBalance} onChange={(e) => setForm({ ...form, opening: e.target.value.replace(/[^\d.,]/g, '') })} />
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 text-label">
          <span>
            This is money owed
            <span className="block text-caption text-muted">A card bill or loan: counts against your total.</span>
          </span>
          <input type="checkbox" checked={form.owed} onChange={(e) => setForm({ ...form, owed: e.target.checked })} className="size-5 shrink-0 accent-[var(--app-primary)]" />
        </label>
        <p className="text-caption text-muted">Entries from this date on that use the account are added to or taken from it.</p>
        <ErrorBanner error={Object.keys(errors).length ? null : (save.error ?? close.error ?? remove.error)} />
        <Button type="submit" className="w-full" disabled={!form.name.trim() || openingMinor === null || !form.openingDate} loading={save.isPending}>
          {existing ? 'Save' : 'Add account'}
        </Button>
        {existing && (
          <>
            <Button type="button" variant="secondary" className="w-full" loading={close.isPending} onClick={() => close.mutate()}>
              {existing.archived ? 'Reopen account' : 'Close account'}
            </Button>
            {existing.entries === 0 && (
              <Button type="button" variant="danger" className="w-full" loading={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </>
        )}
      </form>
    </Sheet>
  );
}

/** Cash withdrawn, a card bill paid, money moved to savings: changes two balances, not spending. */
function TransferSheet({ open, accounts, onClose }: { open: boolean; accounts: AccountDTO[]; onClose: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ from: '', to: '', amount: '', date: todayISO(), note: '' });
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setForm({ from: accounts[0]?.id ?? '', to: accounts[1]?.id ?? '', amount: '', date: todayISO(), note: '' });
  }
  const minor = toMinor(form.amount || '0') ?? 0;
  const save = useMutation({
    mutationFn: () => api.post(`/books/${book.id}/transfers`, { fromAccountId: form.from, toAccountId: form.to, amount: minor, date: form.date, note: form.note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'accounts'] });
      queryClient.invalidateQueries({ queryKey: ['book', book.id, 'transfers'] });
      toast({ message: 'Money moved', duration: 2000 });
      onClose();
    },
  });
  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="block">
      <span className="mb-1.5 block text-label font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Move money">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {select(form.from, (from) => setForm({ ...form, from }), 'From')}
          {select(form.to, (to) => setForm({ ...form, to }), 'To')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" inputMode="decimal" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, '') })} />
          <Field label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <Field label="Note (optional)" value={form.note} maxLength={200} placeholder="e.g. ATM, card bill" onChange={(e) => setForm({ ...form, note: e.target.value })} />
        {form.from === form.to && <p className="text-caption text-negative">Pick two different accounts.</p>}
        <ErrorBanner error={save.error} />
        <Button type="submit" className="w-full" disabled={minor <= 0 || form.from === form.to || !form.date} loading={save.isPending}>
          Move {minor > 0 ? formatMoney(minor, book.currency) : 'money'}
        </Button>
        <p className="text-caption text-muted">Moving money isn't spending, so it doesn't touch the budget.</p>
      </form>
    </Sheet>
  );
}
