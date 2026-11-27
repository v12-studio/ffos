import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { canModifyRecord, formatMoney, REPEAT_EVERY, shiftMonthKey, toMinor, type RecurringDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CategoryGlyph, CategoryTile } from '../components/CategoryIcon.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, Chip, EmptyState, ErrorBanner, Field, fieldErrors, inputClass, PageSkeleton, SectionTitle, Segmented, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, minorToInput, monthLabel, todayISO } from '../lib/format.ts';

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

const EVERY_LABEL: Record<number, string> = { 1: 'Every month', 2: 'Every 2 months', 3: 'Every 3 months', 4: 'Every 4 months', 6: 'Every 6 months', 12: 'Every year' };

/** "5th monthly", "5th every 3 months", "5 Mar every year". */
function repeatText(r: RecurringDTO): string {
  if (r.everyMonths === 1) return `${ordinal(r.dayOfMonth)} monthly`;
  if (r.everyMonths === 12) return `${r.dayOfMonth} ${shortMonth(r.startMonth).split(' ')[0]} every year`;
  return `${ordinal(r.dayOfMonth)} every ${r.everyMonths} months`;
}

const shortMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

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
  // A month's worth: a yearly entry counts a twelfth, and ones that have finished don't count.
  const monthlyNet = active.filter((r) => r.nextDueMonth).reduce((s, r) => s + (r.type === 'income' ? r.amount : -r.amount) / r.everyMonths, 0);

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
          <span className={`block truncate text-body font-medium ${r.active ? '' : 'text-muted'}`}>{r.note || cat?.name || 'Repeating entry'}</span>
          <span className="block truncate text-label text-muted">
            {[
              r.note ? cat?.name : null,
              repeatText(r),
              r.nextDueMonth && r.nextDueMonth !== currentMonth() && r.everyMonths > 1 ? `next ${shortMonth(r.nextDueMonth)}` : null,
              r.startMonth > currentMonth() && r.everyMonths === 1 ? `from ${monthLabel(r.startMonth).split(' ')[0]}` : null,
              r.endMonth ? (r.nextDueMonth ? `until ${shortMonth(r.endMonth)}` : 'finished') : null,
              book.memberCount > 1 ? r.createdByName : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className={`shrink-0 text-body font-semibold tabular ${r.type === 'income' ? 'text-positive' : ''} ${r.active ? '' : 'opacity-60'}`}>
          {r.type === 'income' ? '+' : '−'}
          {money(r.amount)}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <PageTitle
        subtitle="Rent, salary, EMIs, yearly insurance… offered on the Overview once their day comes"
        action={
          can('txn.create') && (
            <Button className="min-h-9! shrink-0 px-3 text-label" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add
            </Button>
          )
        }
      >
        Repeating entries
      </PageTitle>
      <ErrorBanner error={rules.error} />

      {rules.isLoading ? (
        <PageSkeleton />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat className="size-5" />} title="No repeating entries yet">
            Add one here, or tick "Repeat every month" when you add a transaction.
          </EmptyState>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <SectionTitle>
                Active · {monthlyNet < 0 ? '−' : '+'}
                {money(Math.round(Math.abs(monthlyNet)))} a month
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
    everyMonths: existing?.everyMonths ?? 1,
    // How it ends: never, after a number of payments (counted from the start), or in a given month.
    ends: (existing?.endMonth ? 'month' : 'never') as 'never' | 'after' | 'month',
    times: '12',
    endMonth: existing?.endMonth ?? shiftMonthKey(thisMonth, 11),
  });
  const start = existing?.startMonth ?? form.startMonth;
  const endMonth =
    form.ends === 'never' ? null : form.ends === 'month' ? form.endMonth : shiftMonthKey(start, (Math.max(1, Number(form.times) || 1) - 1) * form.everyMonths);
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
    everyMonths: form.everyMonths,
    endMonth,
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
  const endsBeforeStart = endMonth !== null && endMonth < start;
  const valid = (toMinor(form.amount) ?? 0) > 0 && form.categoryId && day >= 1 && day <= 31 && !endsBeforeStart;

  return (
    <Sheet open={editing !== null} onClose={onClose} title={existing ? (canEdit ? 'Edit repeating entry' : 'Repeating entry') : 'New repeating entry'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {existing && !existing.active && (
          <p className="rounded-lg bg-subtle px-3 py-2 text-label text-muted">Paused: it isn't offered on the Overview.</p>
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
        {day > 28 && day <= 31 && <p className="-mt-2 text-caption text-muted">In shorter months it falls on the last day.</p>}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Repeats</span>
            <select value={form.everyMonths} disabled={!canEdit} onChange={(e) => setForm({ ...form, everyMonths: Number(e.target.value) })} className={inputClass}>
              {REPEAT_EVERY.map((n) => (
                <option key={n} value={n}>
                  {EVERY_LABEL[n]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Ends</span>
            <select value={form.ends} disabled={!canEdit} onChange={(e) => setForm({ ...form, ends: e.target.value as typeof form.ends })} className={inputClass}>
              <option value="never">Never</option>
              <option value="after">After a number of times</option>
              <option value="month">In a chosen month</option>
            </select>
          </label>
        </div>
        {form.ends === 'after' && (
          <Field
            label="How many times in all"
            inputMode="numeric"
            value={form.times}
            disabled={!canEdit}
            hint={endMonth ? `Last one in ${monthLabel(endMonth)}. Handy for EMIs: enter the number of instalments.` : undefined}
            onChange={(e) => setForm({ ...form, times: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          />
        )}
        {form.ends === 'month' && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Last month</span>
            <input type="month" value={form.endMonth} disabled={!canEdit} min={start} onChange={(e) => setForm({ ...form, endMonth: e.target.value })} className={inputClass} />
          </label>
        )}
        {endsBeforeStart && <p className="-mt-2 text-caption text-negative">It has to end after it starts ({monthLabel(start)}).</p>}

        <div>
          <p className="mb-2 text-label font-medium">Category</p>
          <div className="flex flex-wrap gap-2">
            {options.map((c) => {
              const selected = form.categoryId === c.id;
              return (
                <Chip key={c.id} selected={selected} disabled={!canEdit} onClick={() => setForm({ ...form, categoryId: c.id })}>
                  <CategoryGlyph category={c} selected={selected} />
                  {c.name}
                </Chip>
              );
            })}
          </div>
          {errors.categoryId && <p className="mt-1.5 text-label text-negative">{errors.categoryId}</p>}
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
            <p className="mb-2 text-label font-medium">Starts</p>
            <Segmented
              value={form.startMonth}
              onChange={(startMonth) => setForm({ ...form, startMonth })}
              options={[
                { value: thisMonth, label: monthLabel(thisMonth) },
                { value: shiftMonthKey(thisMonth, 1), label: monthLabel(shiftMonthKey(thisMonth, 1)) },
              ]}
            />
            <p className="mt-1.5 text-caption text-muted">Already recorded it this month? Start next month.</p>
          </div>
        )}

        <ErrorBanner error={Object.keys(errors).length ? null : (save.error ?? toggle.error ?? remove.error)} />
        {canEdit && (
          <Button type="submit" className="w-full" disabled={!valid} loading={save.isPending}>
            {existing ? 'Save changes' : 'Add repeating entry'}
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
                title: 'Remove this repeating entry?',
                message: 'Entries already added from it stay. It just stops being offered.',
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
