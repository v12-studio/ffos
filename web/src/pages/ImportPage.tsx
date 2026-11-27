import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileUp, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { formatMoney, type CategoryDTO, type ImportResultDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, ErrorBanner, inputClass, SectionTitle, Segmented } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { DATE_ORDER_LABEL, guessDateOrder, isDebit, parseAmount, parseCsv, parseDate, type DateOrder } from '../lib/csv.ts';

type AmountMode = 'signed' | 'split' | 'drcr';

interface Mapping {
  date: number;
  note: number;
  amount: number;
  debit: number;
  credit: number;
  drcr: number;
  category: number;
}

interface Row {
  line: number;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  note: string;
  categoryId: string;
}

const NONE = -1;
const BATCH = 500;

/** Finds the column whose header matches, e.g. "Txn Date" for date. */
function findColumn(headers: string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return NONE;
}

function guessMapping(headers: string[]): { mapping: Mapping; mode: AmountMode } {
  const mapping: Mapping = {
    date: findColumn(headers, /^date$/i, /date/i),
    note: findColumn(headers, /narration|description|particulars|details|remarks|note|memo/i),
    amount: findColumn(headers, /^amount$/i, /amount|amt/i),
    debit: findColumn(headers, /debit|withdrawal|dr\b|paid out/i),
    credit: findColumn(headers, /credit|deposit|cr\b|paid in/i),
    drcr: findColumn(headers, /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn type|transaction type)$/i),
    category: findColumn(headers, /category/i),
  };
  const mode: AmountMode = mapping.debit >= 0 && mapping.credit >= 0 && mapping.debit !== mapping.credit ? 'split' : mapping.drcr >= 0 ? 'drcr' : 'signed';
  return { mapping, mode };
}

/**
 * Bring in a bank statement or any spreadsheet saved as CSV: match its columns, choose categories,
 * check a preview, import. Rows already in the book are skipped, and the whole import can be undone.
 */
export function ImportPage() {
  const { book, can } = useCurrentBook();
  const categories = useCategories(book.id);
  if (!can('book.import')) return <Navigate to="/more" replace />;
  return (
    <div className="space-y-5">
      <Link to="/more" className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-label font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageTitle subtitle={`Into ${book.name}. Save the statement from your bank or spreadsheet app as CSV.`}>Import transactions</PageTitle>
      {categories.data && <Importer categories={categories.data} />}
    </div>
  );
}

function Importer({ categories }: { categories: CategoryDTO[] }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileError, setFileError] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [mode, setMode] = useState<AmountMode>('signed');
  const [flip, setFlip] = useState(false);
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const live = categories.filter((c) => !c.archived);
  const expenseCats = live.filter((c) => c.kind === 'expense');
  const incomeCats = live.filter((c) => c.kind === 'income');
  const fallback = (list: CategoryDTO[]) => (list.find((c) => /^other/i.test(c.name)) ?? list[0])?.id ?? '';
  const [defaultExpense, setDefaultExpense] = useState(fallback(expenseCats));
  const [defaultIncome, setDefaultIncome] = useState(fallback(incomeCats));
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<(ImportResultDTO & { importId: string }) | null>(null);
  const [progress, setProgress] = useState(0);

  const headers = table?.[0] ?? [];
  const body = table?.slice(1) ?? [];

  const loadFile = async (file: File) => {
    setFileError('');
    setResult(null);
    if (file.size > 5_000_000) return setFileError('That file is over 5 MB. Split it into smaller date ranges.');
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setFileError("Couldn't find any rows. Make sure the file is a CSV with a header row.");
    // Some banks put account details above the real header: start at the first row that looks like one.
    const headerAt = Math.max(0, rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3));
    const trimmed = rows.slice(headerAt);
    const guess = guessMapping(trimmed[0]!);
    setFileName(file.name);
    setTable(trimmed);
    setMapping(guess.mapping);
    setMode(guess.mode);
    setFlip(false);
    setDateOrder(guessDateOrder(trimmed.slice(1, 30).map((r) => r[guess.mapping.date] ?? '')));
    setCategoryMap({});
  };

  // Category names in the file, matched to the book's categories by name where possible.
  const fileCategories = useMemo(() => {
    if (!mapping || mapping.category === NONE) return [];
    return [...new Set(body.map((r) => r[mapping.category] ?? '').filter(Boolean))].slice(0, 60);
  }, [table, mapping?.category]);
  const categoryFor = (value: string, type: 'income' | 'expense') => {
    const pool = type === 'income' ? incomeCats : expenseCats;
    const chosen = categoryMap[`${type}:${value}`];
    if (chosen && pool.some((c) => c.id === chosen)) return chosen;
    const byName = pool.find((c) => c.name.toLowerCase() === value.toLowerCase());
    return byName?.id ?? (type === 'income' ? defaultIncome : defaultExpense);
  };

  const parsed = useMemo(() => {
    const rows: Row[] = [];
    const problems: { line: number; reason: string }[] = [];
    if (!mapping) return { rows, problems };
    body.forEach((r, i) => {
      const line = i + 2;
      const date = parseDate(r[mapping.date] ?? '', dateOrder);
      if (!date) return problems.push({ line, reason: `date "${r[mapping.date] ?? ''}" not recognised` });
      let signed: number | null = null;
      if (mode === 'split') {
        const out = parseAmount(r[mapping.debit] ?? '');
        const inn = parseAmount(r[mapping.credit] ?? '');
        signed = out ? -Math.abs(out) : inn ? Math.abs(inn) : null;
      } else {
        const value = parseAmount(r[mapping.amount] ?? '');
        if (value !== null && mode === 'drcr') {
          const debit = isDebit(r[mapping.drcr] ?? '');
          signed = debit === null ? value : debit ? -Math.abs(value) : Math.abs(value);
        } else signed = value;
        if (signed !== null && flip) signed = -signed;
      }
      if (signed === null) return problems.push({ line, reason: 'no amount' });
      if (signed === 0) return problems.push({ line, reason: 'amount is zero' });
      const type = signed < 0 ? 'expense' : 'income';
      const categoryId = categoryFor(mapping.category === NONE ? '' : (r[mapping.category] ?? ''), type);
      if (!categoryId) return problems.push({ line, reason: `no ${type} category to put it in` });
      const amount = Math.abs(signed);
      if (amount > 1_000_000_000_00) return problems.push({ line, reason: 'amount too large' });
      rows.push({ line, type, amount, date, note: (mapping.note === NONE ? '' : (r[mapping.note] ?? '')).replace(/\s+/g, ' ').slice(0, 200), categoryId });
    });
    return { rows, problems };
  }, [table, mapping, mode, flip, dateOrder, categoryMap, defaultExpense, defaultIncome]);

  const importer = useMutation({
    mutationFn: async () => {
      const importId = crypto.randomUUID();
      let added = 0;
      let skipped = 0;
      setProgress(0);
      for (let i = 0; i < parsed.rows.length; i += BATCH) {
        const batch = parsed.rows.slice(i, i + BATCH).map(({ line: _line, ...row }) => row);
        const res = await api.post<ImportResultDTO>(`/books/${book.id}/transactions/import`, { importId, skipDuplicates, rows: batch });
        added += res.added;
        skipped += res.skipped;
        setProgress(Math.min(parsed.rows.length, i + BATCH));
      }
      return { importId, added, skipped };
    },
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['book', book.id] });
    },
  });
  const undo = useMutation({
    mutationFn: (importId: string) => api.del<{ removed: number }>(`/books/${book.id}/transactions/import/${importId}`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      toast({ message: `Removed ${res.removed} imported transaction${res.removed === 1 ? '' : 's'}. They're in Recently deleted for 30 days.`, duration: 4000 });
      setResult(null);
      setTable(null);
    },
  });

  if (result) {
    return (
      <Card className="space-y-3 p-4">
        <p className="text-title font-semibold">
          {result.added} transaction{result.added === 1 ? '' : 's'} imported
        </p>
        {result.skipped > 0 && <p className="text-label text-muted">{result.skipped} were already in the book and were skipped.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/transactions?scope=all" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-body font-medium text-primary-fg">
            See transactions
          </Link>
          {result.added > 0 && (
            <Button variant="secondary" className="flex-1" loading={undo.isPending} onClick={() => undo.mutate(result.importId)}>
              <Undo2 className="size-4" /> Undo this import
            </Button>
          )}
        </div>
        <ErrorBanner error={undo.error} />
      </Card>
    );
  }

  const columnSelect = (label: string, key: keyof Mapping, optional = false) => (
    <label className="block">
      <span className="mb-1 block text-label font-medium">{label}</span>
      <select value={mapping![key]} onChange={(e) => setMapping({ ...mapping!, [key]: Number(e.target.value) })} className={inputClass}>
        {optional && <option value={NONE}>None</option>}
        {!optional && mapping![key] === NONE && <option value={NONE}>Pick a column</option>}
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  const categorySelect = (value: string, onChange: (id: string) => void, list: CategoryDTO[], label?: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} aria-label={label}>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  const ready = mapping && mapping.date !== NONE && (mode === 'split' ? mapping.debit !== NONE && mapping.credit !== NONE : mapping.amount !== NONE) && (mode !== 'drcr' || mapping.drcr !== NONE);
  const expenses = parsed.rows.filter((r) => r.type === 'expense');
  const income = parsed.rows.filter((r) => r.type === 'income');
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 text-label font-medium text-accent hover:bg-subtle">
          <FileUp className="size-4" />
          {fileName ? `${fileName} · choose another file` : 'Choose a CSV file'}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
          />
        </label>
        {fileError && <p className="mt-2 text-label text-negative">{fileError}</p>}
        {!table && (
          <p className="mt-3 text-caption text-muted">
            Most banks offer "Download statement" as CSV or Excel. If you get an Excel file, open it and use Save As → CSV. PDF statements can't be read.
          </p>
        )}
      </Card>

      {table && mapping && (
        <>
          <section>
            <SectionTitle>Columns</SectionTitle>
            <Card className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {columnSelect('Date', 'date')}
                {columnSelect('Description', 'note', true)}
              </div>
              <div>
                <p className="mb-1.5 text-label font-medium">How amounts are written</p>
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'signed', label: 'One column' },
                    { value: 'split', label: 'Debit + credit' },
                    { value: 'drcr', label: 'Amount + Dr/Cr' },
                  ]}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {mode === 'split' ? (
                  <>
                    {columnSelect('Money out (debit)', 'debit')}
                    {columnSelect('Money in (credit)', 'credit')}
                  </>
                ) : (
                  <>
                    {columnSelect('Amount', 'amount')}
                    {mode === 'drcr' && columnSelect('Dr / Cr column', 'drcr')}
                  </>
                )}
              </div>
              {mode === 'signed' && (
                <label className="flex min-h-11 items-center justify-between gap-3 text-label">
                  <span>
                    Money out is shown as a positive number
                    <span className="block text-caption text-muted">Turn on if spending shows as 450.00 rather than −450.00 (common on card statements)</span>
                  </span>
                  <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} className="size-5 shrink-0 accent-[var(--app-primary)]" />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-label font-medium">Dates are written</span>
                <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)} className={inputClass}>
                  {(Object.keys(DATE_ORDER_LABEL) as DateOrder[]).map((o) => (
                    <option key={o} value={o}>
                      {DATE_ORDER_LABEL[o]}
                    </option>
                  ))}
                </select>
              </label>
            </Card>
          </section>

          <section>
            <SectionTitle>Categories</SectionTitle>
            <Card className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-label font-medium">Spending goes to</span>
                  {categorySelect(defaultExpense, setDefaultExpense, expenseCats)}
                </label>
                <label className="block">
                  <span className="mb-1 block text-label font-medium">Money in goes to</span>
                  {categorySelect(defaultIncome, setDefaultIncome, incomeCats)}
                </label>
              </div>
              {columnSelect('Category column in the file (optional)', 'category', true)}
              {fileCategories.length > 0 && (
                <div className="space-y-2">
                  <p className="text-caption text-muted">Match the file's categories to this book's. Unmatched ones use the choices above.</p>
                  {fileCategories.map((value) => {
                    const type = parsed.rows.find((r) => body[r.line - 2]?.[mapping.category] === value)?.type ?? 'expense';
                    return (
                      <div key={value} className="grid grid-cols-2 items-center gap-2">
                        <span className="truncate text-label">{value}</span>
                        {categorySelect(categoryFor(value, type), (id) => setCategoryMap((m) => ({ ...m, [`${type}:${value}`]: id })), type === 'income' ? incomeCats : expenseCats, `Category for ${value}`)}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-caption text-muted">You can change any entry's category afterwards, or several at once from Transactions.</p>
            </Card>
          </section>

          <section>
            <SectionTitle>Preview</SectionTitle>
            <Card className="overflow-hidden">
              <div className="border-b border-line px-4 py-3 text-label tabular">
                {ready ? (
                  <>
                    <strong className="font-semibold">{parsed.rows.length}</strong> to import: {expenses.length} spending ({formatMoney(expenses.reduce((s, r) => s + r.amount, 0), book.currency)}),{' '}
                    {income.length} money in ({formatMoney(income.reduce((s, r) => s + r.amount, 0), book.currency)})
                    {parsed.problems.length > 0 && <span className="text-warning"> · {parsed.problems.length} rows will be left out</span>}
                  </>
                ) : (
                  <span className="text-muted">Pick the date and amount columns above.</span>
                )}
              </div>
              {ready && (
                <div className="divide-y divide-line">
                  {parsed.rows.slice(0, 8).map((r) => (
                    <div key={r.line} className="flex items-center gap-3 px-4 py-2 text-label">
                      <span className="w-20 shrink-0 text-muted tabular">{r.date}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.note || '—'}</span>
                        <span className="block truncate text-caption text-muted">{nameOf(r.categoryId)}</span>
                      </span>
                      <span className={`shrink-0 font-medium tabular ${r.type === 'income' ? 'text-positive' : ''}`}>
                        {r.type === 'income' ? '+' : '−'}
                        {formatMoney(r.amount, book.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {ready && parsed.problems.length > 0 && (
                <details className="border-t border-line px-4 py-2 text-caption text-muted">
                  <summary className="cursor-pointer py-1">Rows left out</summary>
                  <ul className="space-y-0.5 pb-1">
                    {parsed.problems.slice(0, 20).map((p) => (
                      <li key={p.line}>
                        Row {p.line}: {p.reason}
                      </li>
                    ))}
                    {parsed.problems.length > 20 && <li>…and {parsed.problems.length - 20} more</li>}
                  </ul>
                </details>
              )}
            </Card>
          </section>

          <label className="flex min-h-11 items-center justify-between gap-3 px-0.5 text-label">
            <span>
              Skip rows already in the book
              <span className="block text-caption text-muted">Same date, amount and description. Safe to import overlapping statements.</span>
            </span>
            <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="size-5 shrink-0 accent-[var(--app-primary)]" />
          </label>
          <ErrorBanner error={importer.error} />
          <Button className="w-full" disabled={!ready || parsed.rows.length === 0} loading={importer.isPending} onClick={() => importer.mutate()}>
            {importer.isPending ? `Importing ${progress} of ${parsed.rows.length}…` : `Import ${parsed.rows.length} transaction${parsed.rows.length === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </div>
  );
}
