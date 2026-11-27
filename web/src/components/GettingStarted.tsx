import { Check, ChevronRight, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth } from '../lib/format.ts';
import { useOpenTransaction } from './AppShell.tsx';
import { Card } from './ui.tsx';

const key = (bookId: string) => `ffos.gettingStarted.${bookId}`;
const checkedKey = (bookId: string) => `ffos.settingsChecked.${bookId}`;

/** Book settings were opened on this device: the "check settings" step counts as done. */
export function markSettingsChecked(bookId: string) {
  try {
    localStorage.setItem(checkedKey(bookId), '1');
  } catch {
    // ignore
  }
}

function settingsChecked(bookId: string) {
  try {
    return localStorage.getItem(checkedKey(bookId)) === '1';
  } catch {
    return false;
  }
}

function isDismissed(bookId: string) {
  try {
    return localStorage.getItem(key(bookId)) === 'done';
  } catch {
    return false;
  }
}

/** Running as an installed app (home screen), not in a browser tab. */
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * A short checklist for a new book's owner: settings, a first budget, a first entry, family, install.
 * Ticks itself off as things get done; hidden for good once dismissed or finished.
 */
export function GettingStarted({ hasBudget, hasEntries }: { hasBudget: boolean; hasEntries: boolean }) {
  const { book, can } = useCurrentBook();
  const openTransaction = useOpenTransaction();
  const [dismissed, setDismissed] = useState(() => isDismissed(book.id));
  const [forBook, setForBook] = useState(book.id);
  if (forBook !== book.id) {
    setForBook(book.id);
    setDismissed(isDismissed(book.id));
  }
  const settingsDone = settingsChecked(book.id) || book.currency !== 'INR' || book.monthStartDay !== 1 || book.timeZone !== 'Asia/Kolkata';
  const steps: { done: boolean; title: string; detail: string; action: ReactNode }[] = [
    ...(can('book.settings')
      ? [{ done: settingsDone, title: 'Check currency and salary day', detail: 'So amounts and "this month" match your family', action: <Link to="/more?open=book" className="absolute inset-0" aria-label="Open book settings" /> }]
      : []),
    ...(can('budget.manage')
      ? [{ done: hasBudget, title: 'Plan your first budget', detail: 'Split your income into bills, spending and savings', action: <Link to={`/budget/${currentMonth()}/edit`} className="absolute inset-0" aria-label="Plan a budget" /> }]
      : []),
    ...(can('txn.create')
      ? [{ done: hasEntries, title: 'Add a transaction', detail: 'Or import a bank statement from Settings', action: <button onClick={() => openTransaction()} className="absolute inset-0" aria-label="Add a transaction" /> }]
      : []),
    book.isPersonal
      ? { done: false, title: 'Share with family', detail: 'Personal is private: create a shared book from the book menu', action: <span /> }
      : { done: book.memberCount > 1, title: 'Invite your family', detail: 'Everyone adds what they spend; you see it together', action: <Link to="/members" className="absolute inset-0" aria-label="Invite members" /> },
    { done: installed(), title: 'Put it on your home screen', detail: 'Browser menu → Add to Home Screen, for one-tap adding', action: <Link to="/help#install" className="absolute inset-0" aria-label="How to install" /> },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (dismissed || book.role !== 'owner' || left === 0) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(key(book.id), 'done');
    } catch {
      // Private mode: hidden for this visit only.
    }
    setDismissed(true);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 text-body font-semibold">
          Getting started <span className="font-normal text-muted">· {steps.length - left} of {steps.length} done</span>
        </p>
        <button onClick={dismiss} className="-mr-2 grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle" aria-label="Hide getting started">
          <X className="size-4" />
        </button>
      </div>
      <ul className="divide-y divide-line">
        {steps.map((step) => (
          <li key={step.title} className="relative flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-subtle/60">
            <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${step.done ? 'border-positive bg-positive text-white' : 'border-line'}`} aria-hidden>
              {step.done && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-label font-medium ${step.done ? 'text-muted line-through' : ''}`}>{step.title}</span>
              <span className="block truncate text-caption text-muted">{step.detail}</span>
            </span>
            {!step.done && <ChevronRight className="size-4 shrink-0 text-muted" />}
            {!step.done && step.action}
          </li>
        ))}
      </ul>
    </Card>
  );
}
