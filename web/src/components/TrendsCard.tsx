import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatMoney, type TrendsDTO } from '@ffos/shared';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { monthLabel } from '../lib/format.ts';
import { Card } from './ui.tsx';

const MONTHS = 6;

/**
 * Income vs expenses for the six months ending at `month`, as paired bars on one scale.
 * Hovering or focusing a month shows its numbers above the chart; tapping it opens that month.
 */
export function TrendsCard({ month, onSelect }: { month: string; onSelect: (month: string) => void }) {
  const { book } = useCurrentBook();
  const [hovered, setHovered] = useState<string | null>(null);
  const trends = useQuery({
    queryKey: ['book', book.id, 'trends', month, MONTHS],
    queryFn: () => api.get<TrendsDTO>(`/books/${book.id}/trends?end=${month}&months=${MONTHS}`),
    placeholderData: (prev) => prev,
  });
  const data = trends.data?.months;
  if (!data || data.every((m) => !m.income && !m.expense)) return null;

  const money = (n: number) => formatMoney(n, book.currency);
  const max = Math.max(...data.map((m) => Math.max(m.income, m.expense)), 1);
  const focus = data.find((m) => m.month === (hovered ?? month)) ?? data[data.length - 1]!;
  const net = focus.income - focus.expense;
  const withSpending = data.filter((m) => m.expense > 0);
  const avgSpend = withSpending.length ? Math.round(withSpending.reduce((s, m) => s + m.expense, 0) / withSpending.length / 100) * 100 : 0;
  const barHeight = (v: number) => (v > 0 ? `max(2px, ${(v / max) * 100}%)` : '0');

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">Last {MONTHS} months</p>
        <div className="flex gap-3 text-xs text-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-income" /> Income
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-chart-expense" /> Expenses
          </span>
        </div>
      </div>

      {/* Readout for the hovered (or selected) month. */}
      <div className="mt-2 min-h-11" aria-live="polite">
        <p className="text-sm font-semibold">{monthLabel(focus.month)}</p>
        <p className="text-[13px] text-muted tabular">
          Income {money(focus.income)} · Expenses {money(focus.expense)} ·{' '}
          <span className={`whitespace-nowrap ${net < 0 ? 'text-negative' : 'text-ink'}`}>
            {'Net '}
            {net < 0 ? '−' : '+'}
            {money(Math.abs(net))}
          </span>
        </p>
      </div>

      <div className="mt-3 flex h-32 items-stretch gap-1 border-b border-line" onMouseLeave={() => setHovered(null)}>
        {data.map((m) => {
          const selected = m.month === month;
          return (
            <button
              key={m.month}
              onClick={() => onSelect(m.month)}
              onMouseEnter={() => setHovered(m.month)}
              onFocus={() => setHovered(m.month)}
              onBlur={() => setHovered(null)}
              aria-label={`${monthLabel(m.month)}: income ${money(m.income)}, expenses ${money(m.expense)}`}
              aria-current={selected ? 'true' : undefined}
              className={`flex flex-1 items-end justify-center gap-[2px] rounded-t-md px-1 transition-colors ${
                selected || hovered === m.month ? 'bg-subtle' : ''
              }`}
            >
              <span className="w-full max-w-4 rounded-t-[4px] bg-chart-income" style={{ height: barHeight(m.income) }} />
              <span className="w-full max-w-4 rounded-t-[4px] bg-chart-expense" style={{ height: barHeight(m.expense) }} />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1" aria-hidden>
        {data.map((m) => (
          <span key={m.month} className={`flex-1 text-center text-[11px] ${m.month === month ? 'font-semibold text-ink' : 'text-muted'}`}>
            {monthLabel(m.month).slice(0, 3)}
          </span>
        ))}
      </div>

      {avgSpend > 0 && (
        <p className="mt-3 text-[13px] text-muted tabular">
          Average spending {money(avgSpend)} a month
          {focus.expense > 0 && focus.month === month && (
            <>
              {' · '}
              {monthLabel(month).split(' ')[0]} is{' '}
              {focus.expense > avgSpend
                ? `${money(focus.expense - avgSpend)} above`
                : focus.expense < avgSpend
                  ? `${money(avgSpend - focus.expense)} below`
                  : 'right on'}{' '}
              average
            </>
          )}
        </p>
      )}
    </Card>
  );
}
