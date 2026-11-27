import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import type { ExportFormat, ExportKind } from '@ffos/shared';
import { download } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.ts';
import { useToast } from './Toast.tsx';
import { useCategories } from './TransactionSheet.tsx';
import { Button, ErrorBanner, inputClass, Segmented, Sheet } from './ui.tsx';

type Period = 'month' | 'range' | 'all';

/** What the sheet starts on, from the screen it was opened from. */
export interface ExportPreset {
  what?: ExportKind;
  period?: Period;
  month?: string;
  categoryId?: string | null;
}

const WHAT: { value: ExportKind; label: string; detail: string }[] = [
  { value: 'budget', label: 'Budget', detail: 'Planned and actual for each head, month by month, with income. Excel adds a monthly summary sheet.' },
  { value: 'transactions', label: 'Transactions', detail: 'Every entry: date, category, section, amount, note and who added it.' },
  {
    value: 'everything',
    label: 'Everything',
    detail: 'Budget, transactions and categories together: one Excel workbook with a sheet for each, or a JSON backup of the book.',
  },
];

const FORMAT_LABEL: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'Excel', json: 'JSON backup' };

const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Download the budget, transactions, or both, for one month, a range of months or all time,
 * optionally for a single head or category.
 */
export function ExportSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: ExportPreset }) {
  // Mounted only while open, so each opening starts from the preset.
  if (!open) return null;
  return <ExportDialog onClose={onClose} preset={preset ?? {}} />;
}

function ExportDialog({ onClose, preset }: { onClose: () => void; preset: ExportPreset }) {
  const { book } = useCurrentBook();
  const toast = useToast();
  const categories = useCategories(book.id);
  const start = preset.month ?? currentMonth();
  const [what, setWhat] = useState<ExportKind>(preset.what ?? 'transactions');
  const [period, setPeriod] = useState<Period>(preset.period ?? (preset.month ? 'month' : 'all'));
  const [month, setMonth] = useState(start);
  const [from, setFrom] = useState(shiftMonth(start, -2));
  const [to, setTo] = useState(start);
  const [categoryId, setCategoryId] = useState(preset.categoryId ?? '');
  const [format, setFormat] = useState<ExportFormat>(preset.what === 'everything' ? 'xlsx' : 'csv');

  const formats: ExportFormat[] = what === 'everything' ? ['xlsx', 'json'] : ['csv', 'xlsx'];
  const fmt = formats.includes(format) ? format : formats[0]!;
  // Budget heads are expense categories; "everything" is always the whole book.
  const all = categories.data ?? [];
  const choices = what === 'everything' ? [] : all.filter((c) => what === 'transactions' || c.kind === 'expense');
  const category = choices.find((c) => c.id === categoryId);

  const rangeError =
    period === 'month'
      ? !isMonth(month) && 'Pick a month'
      : period === 'range'
        ? !isMonth(from) || !isMonth(to)
          ? 'Pick both months'
          : from > to && 'The first month must come before the last'
        : false;

  const params = new URLSearchParams({ what, format: fmt });
  if (period === 'month') {
    params.set('from', month);
    params.set('to', month);
  } else if (period === 'range') {
    params.set('from', from);
    params.set('to', to);
  }
  if (category) params.set('category', category.id);

  const periodText = period === 'month' ? monthLabel(month) : period === 'range' ? `${monthLabel(from)} – ${monthLabel(to)}` : 'All time';
  const periodSlug = period === 'month' ? month : period === 'range' ? `${from}-to-${to}` : 'all-time';
  const kind = fmt === 'json' ? 'backup' : what;
  const filename = [`ffos-${slug(book.name) || 'book'}`, kind, category && slug(category.name), periodSlug].filter(Boolean).join('-') + `.${fmt}`;

  const exporter = useMutation({
    mutationFn: () => download(`/books/${book.id}/export?${params}`, filename),
    onSuccess: () => {
      toast({ message: `${WHAT.find((w) => w.value === what)!.label} exported`, duration: 2500 });
      onClose();
    },
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Export"
      footer={
        <>
          <ErrorBanner error={exporter.error} />
          <p className="truncate text-caption text-muted">
            {category ? `${category.name} · ` : ''}
            {periodText} · {FORMAT_LABEL[fmt]}
          </p>
          <Button className="w-full" disabled={Boolean(rangeError)} loading={exporter.isPending} onClick={() => exporter.mutate()}>
            <Download className="size-4" /> Download
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-1.5 text-label font-medium">What to export</p>
          <Segmented value={what} onChange={setWhat} options={WHAT.map(({ value, label }) => ({ value, label }))} />
          <p className="mt-1.5 text-caption text-muted">{WHAT.find((w) => w.value === what)!.detail}</p>
        </div>

        {what !== 'everything' && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">{what === 'budget' ? 'Head' : 'Category'}</span>
            <select value={category ? categoryId : ''} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">{what === 'budget' ? 'All heads' : 'All categories'}</option>
              {what === 'budget' ? (
                choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? ' (hidden)' : ''}
                  </option>
                ))
              ) : (
                <>
                  <optgroup label="Expense">
                    {choices
                      .filter((c) => c.kind === 'expense')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.archived ? ' (hidden)' : ''}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Income">
                    {choices
                      .filter((c) => c.kind === 'income')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.archived ? ' (hidden)' : ''}
                        </option>
                      ))}
                  </optgroup>
                </>
              )}
            </select>
          </label>
        )}

        <div>
          <p className="mb-1.5 text-label font-medium">Period</p>
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: 'One month' },
              { value: 'range', label: 'Range' },
              { value: 'all', label: 'All time' },
            ]}
          />
          {period === 'month' && (
            <input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} aria-invalid={!isMonth(month)} className={`${inputClass} mt-2`} />
          )}
          {period === 'range' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-caption text-muted">From</span>
                <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!isMonth(from) || from > to} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption text-muted">To</span>
                <input type="month" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!isMonth(to) || from > to} className={inputClass} />
              </label>
            </div>
          )}
          {rangeError && <p className="mt-1.5 text-caption text-negative">{rangeError}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-label font-medium">Format</p>
          <Segmented value={fmt} onChange={setFormat} options={formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))} />
          <p className="mt-1.5 text-caption text-muted">
            {fmt === 'csv'
              ? 'One table that opens in any spreadsheet app.'
              : fmt === 'xlsx'
                ? what === 'transactions'
                  ? 'An Excel file with real dates and amounts, ready to sort and total.'
                  : 'An Excel workbook with a sheet for each part. Opens in Excel, Google Sheets and Numbers.'
                : 'For safekeeping or moving to another app, not for reading.'}
          </p>
        </div>

        <p className="text-caption text-muted">Deleted entries and phone numbers are never included.</p>
      </div>
    </Sheet>
  );
}
