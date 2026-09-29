import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { canModifyRecord, formatMoney, shiftMonthKey, toMinor, type RecurringDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CategoryTile, categoryIcon } from '../components/CategoryIcon.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, Field, fieldErrors, inputClass, SectionTitle, Segmented, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, minorToInput, monthLabel, todayISO } from '../lib/format.ts';

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

export function RecurringPage() {
  const { book, can } = useCurrentBook();
  const categories = useCategories(book.id);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const [editing, setEditing] = useState<RecurringDTO | 'new' | null>(null);
  const rules = useQuery({
    queryKey: ['book', book.id, 'recurring'],
    queryFn: () => api.get<RecurringDTO[]>(`/books/${book.id}/recurring`),
  });
  const list = rules.data ?? [];
  const active = list.filter((r) => r.active);
  const paused = list.filter((r) => !r.active);
  const money = (n: number) => formatMoney(n, book.currency);
  const monthlyNet = active.reduce((s, r) => s + (r.type === 'income' ? r.amount : -r.amount), 0);

  const row = (r: RecurringDTO) => {
    const cat = byId.get(r.categoryId);
    return (
      <button
        key={r.id}
        onClick={() => setEditing(r)}
        className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60 active:bg-subtle"
      >
        <CategoryTile category={cat} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-medium ${r.active ? '' : 'text-muted'}`}>{r.note || cat?.name || 'Monthly entry'}</span>
          <span className="block truncate text-[13px] text-muted">
            {[
              r.note ? cat?.name : null,
              `${ordinal(r.dayOfMonth)} monthly`,
              r.startMonth > currentMonth() ? `from ${monthLabel(r.startMonth).split(' ')[0]}` : null,
              book.memberCount > 1 ? r.createdByName : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className={`shrink-0 text-[15px] font-semibold tabular ${r.type === 'income' ? 'text-positive' : ''} ${r.active ? '' : 'opacity-60'}`}>
          {r.type === 'income' ? '+' : '−'}
          {money(r.amount)}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <PageTitle
        subtitle="Rent, salary, EMIs… offered on the Overview each month once their day comes"
        action={
          can('txn.create') && (
            <Button className="min-h-9! shrink-0 px-3 text-sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add
            </Button>
          )
        }
      >
        Monthly entries
      </PageTitle>
      <ErrorBanner error={rules.error} />

      {rules.isLoading ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat className="size-5" />} title="No monthly entries yet">
            Add one here, or tick "Repeat every month" when you add a transaction.
          </EmptyState>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <SectionTitle>
                Active · {monthlyNet < 0 ? '−' : '+'}
                {money(Math.abs(monthlyNet))} a month
              </SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">{active.map(row)}</Card>
            </section>
          )}
          {paused.length > 0 && (
            <section>
              <SectionTitle>Paused</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">{paused.map(row)}</Card>
            </section>
          )}
        </>
      )}

      <RecurringSheet key={editing === 'new' ? 'new' : editing?.id ?? 'none'} editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RecurringSheet({ editing, onClose }: { editing: RecurringDTO | 'new' | null; onClose: () => void }) {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const categories = useCategories(book.id);
  const existing = editing && editing !== 'new' ? editing : null;
  const thisMonth = currentMonth();
  const [form, setForm] = useState({
    type: existing?.type ?? ('expense' as 'expense' | 'income'),
    amount: existing ? minorToInput(existing.amount) : '',
    categoryId: existing?.categoryId ?? '',
    note: existing?.note ?? '',
    day: String(existing?.dayOfMonth ?? Number(todayISO().slice(8, 10))),
    startMonth: thisMonth,
  });
  const canEdit = existing ? canModifyRecord(book.role, 'update', existing.createdBy, user!.id) : can('txn.create');
  const canDelete = existing ? canModifyRecord(book.role, 'delete', existing.createdBy, user!.id) : false;
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['book', book.id, 'recurring'] });
    onClose();
  };

  const body = () => ({
    type: form.type,
    amount: toMinor(form.amount) ?? 0,
    categoryId: form.categoryId,
    note: form.note,
    dayOfMonth: Number(form.day),
  });
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.patch(`/books/${book.id}/recurring/${existing.id}`, body())
        : api.post(`/books/${book.id}/recurring`, { ...body(), startMonth: form.startMonth }),
    onSuccess: done,
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/books/${book.id}/recurring/${existing!.id}`, { active: !existing!.active }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.del(`/books/${book.id}/recurring/${existing!.id}`), onSuccess: done });
  const errors = fieldErrors(save.error);
  const options = (categories.data ?? []).filter((c) => c.kind === form.type && (!c.archived || c.id === form.categoryId));
  const day = Number(form.day);
  const valid = (toMinor(form.amount) ?? 0) > 0 && form.categoryId && day >= 1 && day <= 31;

  return (
    <Sheet open={editing !== null} onClose={onClose} title={existing ? (canEdit ? 'Edit monthly entry' : 'Monthly entry') : 'New monthly entry'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {existing && !existing.active && (
          <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">Paused: it isn't offered on the Overview.</p>
        )}
        <Segmented
          value={form.type}
          disabled={!canEdit}
          onChange={(type) => setForm({ ...form, type, categoryId: '' })}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field
            label="Amount"
            inputMode="decimal"
            value={form.amount}
            disabled={!canEdit}
            error={errors.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.,]/g, '') })}
            placeholder="0"
          />
          <Field
            label="Day of month"
            className="w-28"
            inputMode="numeric"
            value={form.day}
            disabled={!canEdit}
            error={errors.dayOfMonth}
            onChange={(e) => setForm({ ...form, day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          />
        </div>
        {day > 28 && day <= 31 && <p className="-mt-2 text-xs text-muted">In shorter months it falls on the last day.</p>}

        <div>
          <p className="mb-2 text-sm font-medium">Category</p>
          <div className="flex flex-wrap gap-2">
            {options.map((c) => {
              const Icon = categoryIcon(c);
              const selected = form.categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setForm({ ...form, categoryId: c.id })}
                  aria-pressed={selected}
                  className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${
                    selected ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface hover:bg-subtle'
                  }`}
                >
                  <Icon className="size-4" strokeWidth={1.75} style={selected ? undefined : { color: c.color }} />
                  {c.name}
                </button>
              );
            })}
          </div>
          {errors.categoryId && <p className="mt-1.5 text-sm text-negative">{errors.categoryId}</p>}
        </div>

        <input
          value={form.note}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="Note, e.g. House rent"
          maxLength={200}
          className={inputClass}
          aria-label="Note"
        />

        {!existing && (
          <div>
            <p className="mb-2 text-sm font-medium">Starts</p>
            <Segmented
              value={form.startMonth}
              onChange={(startMonth) => setForm({ ...form, startMonth })}
              options={[
                { value: thisMonth, label: monthLabel(thisMonth) },
                { value: shiftMonthKey(thisMonth, 1), label: monthLabel(shiftMonthKey(thisMonth, 1)) },
              ]}
            />
            <p className="mt-1.5 text-xs text-muted">Already recorded it this month? Start next month.</p>
          </div>
        )}

        <ErrorBanner error={Object.keys(errors).length ? null : (save.error ?? toggle.error ?? remove.error)} />
        {canEdit && (
          <Button type="submit" className="w-full" disabled={!valid} loading={save.isPending}>
            {existing ? 'Save changes' : 'Add monthly entry'}
          </Button>
        )}
        {existing && canEdit && (
          <Button type="button" variant="secondary" className="w-full" loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {existing.active ? (
              <>
                <Pause className="size-4" /> Pause
              </>
            ) : (
              <>
                <Repeat className="size-4" /> Resume
              </>
            )}
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="danger"
            className="w-full"
            loading={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Remove this monthly entry?',
                message: 'Entries already added from it stay. It just stops being offered each month.',
                confirmLabel: 'Remove',
                danger: true,
              });
              if (ok) remove.mutate();
            }}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </form>
    </Sheet>
  );
}
