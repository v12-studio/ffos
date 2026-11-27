import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMoney, NUMBER_LOCALES } from '@ffos/shared';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { ColourPicker, CurrencySelect, TimeZoneSelect } from './BookFields.tsx';
import { useConfirm } from './Confirm.tsx';
import { markSettingsChecked } from './GettingStarted.tsx';
import { Button, ErrorBanner, Field, fieldErrors, inputClass } from './ui.tsx';

/** Name, currency and colour of the current book, plus leaving or deleting it. */
export function BookSettings({ onDone }: { onDone: () => void }) {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const initial = {
    name: book.name,
    currency: book.currency,
    color: book.color,
    timeZone: book.timeZone ?? 'Asia/Kolkata',
    monthStartDay: book.monthStartDay ?? 1,
    numberLocale: book.numberLocale ?? 'en-IN',
    alertAt: book.alertAt ?? 80,
  };
  const [form, setForm] = useState(initial);
  const [forBook, setForBook] = useState(book.id);
  if (forBook !== book.id) {
    setForBook(book.id);
    setForm(initial);
  }

  useEffect(() => markSettingsChecked(book.id), [book.id]);

  const refresh = () => {
    onDone();
    return queryClient.invalidateQueries({ queryKey: ['books'] });
  };
  const save = useMutation({ mutationFn: () => api.patch(`/books/${book.id}`, form), onSuccess: refresh });
  const leave = useMutation({ mutationFn: () => api.post(`/books/${book.id}/leave`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.del(`/books/${book.id}`), onSuccess: refresh });
  const errors = fieldErrors(save.error);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  const canLeave = book.role !== 'owner';
  const canDelete = can('book.delete') && !book.isPersonal;

  const submit = async () => {
    // Amounts are stored as numbers without a currency, so changing it relabels them rather than converting.
    if (form.currency !== book.currency) {
      const ok = await confirm({
        title: `Change currency to ${form.currency}?`,
        message: `Amounts aren't converted: ${formatMoney(100000, book.currency)} will show as ${formatMoney(100000, form.currency)}. Use this to fix a wrong currency, not to convert.`,
        confirmLabel: 'Change currency',
      });
      if (!ok) return;
    }
    save.mutate();
  };

  return (
    <div className="space-y-4">
      {can('book.settings') && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <CurrencySelect value={form.currency} error={errors.currency} onChange={(currency) => setForm({ ...form, currency })} />
          <ColourPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">How amounts are written</span>
            <select value={form.numberLocale} onChange={(e) => setForm({ ...form, numberLocale: e.target.value })} className={inputClass}>
              {NUMBER_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {formatMoney(12345678, form.currency, l)} · {l === 'en-IN' ? 'lakh, crore' : l === 'en-US' ? 'thousand, million' : 'dot for thousands'}
                </option>
              ))}
            </select>
          </label>
          <TimeZoneSelect value={form.timeZone} onChange={(timeZone) => setForm({ ...form, timeZone })} />

          <div className="space-y-4 border-t border-line pt-4">
            <p className="text-body font-medium">Budget</p>
            <label className="block">
              <span className="mb-1.5 block text-label font-medium">Budget month starts on</span>
              <select value={form.monthStartDay} onChange={(e) => setForm({ ...form, monthStartDay: Number(e.target.value) })} className={inputClass}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1st (calendar month)' : `${d}${d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : d === 21 ? 'st' : 'th'} of each month`}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-caption text-muted">
                {form.monthStartDay === 1
                  ? 'Paid mid-month? Pick your salary day so each budget month runs from one salary to the next.'
                  : `"November" will run ${form.monthStartDay} Nov – ${form.monthStartDay - 1} Dec: each budget month is named after the month it starts in. Changing this moves which days count in each month's budget.`}
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-label font-medium">Warn when spending reaches</span>
              <select value={form.alertAt} onChange={(e) => setForm({ ...form, alertAt: Number(e.target.value) })} className={inputClass}>
                {[60, 70, 75, 80, 85, 90, 95, 100].map((p) => (
                  <option key={p} value={p}>
                    {p}% of a category's budget
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-caption text-muted">Categories past this show under "Needs attention".</span>
            </label>
          </div>
          <ErrorBanner error={Object.keys(errors).length ? null : save.error} />
          <Button type="submit" variant="secondary" className="w-full" disabled={!dirty} loading={save.isPending}>
            Save
          </Button>
        </form>
      )}
      <ErrorBanner error={leave.error ?? remove.error} />
      {canLeave && (
        <Button
          variant="danger"
          className="w-full"
          loading={leave.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: `Leave "${book.name}"?`,
              message: "You'll need a new invite to rejoin.",
              confirmLabel: 'Leave book',
              danger: true,
            });
            if (ok) leave.mutate();
          }}
        >
          <LogOut className="size-4" /> Leave book
        </Button>
      )}
      {canDelete && (
        <Button
          variant="danger"
          className="w-full"
          loading={remove.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: `Delete "${book.name}"?`,
              message: 'It will be removed for all members. The owner can restore it from Books for 30 days.',
              confirmLabel: 'Delete book',
              danger: true,
            });
            if (ok) remove.mutate();
          }}
        >
          <Trash2 className="size-4" /> Delete book
        </Button>
      )}
    </div>
  );
}
