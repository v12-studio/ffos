import { useQuery } from '@tanstack/react-query';
import { ChartColumn, Download } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatMoney, type PeopleReportDTO, type TrendsDTO } from '@ffos/shared';
import { MonthSwitcher, PageTitle } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Card, EmptyState, ErrorBanner, PageSkeleton, SectionTitle, Segmented, StatRow } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { currentMonth, monthLabel, shiftMonth } from '../lib/format.ts';

type Range = 6 | 12 | 24;

const short = (month: string) => monthLabel(month).slice(0, 3);

/**
 * The bigger picture: money in and out month by month, where it went, one category over time, and who
 * spent it. Income and expenses share one scale; everything single-series uses the expense colour.
 */
export function ReportsPage() {
  const { book, can } = useCurrentBook();
  const navigate = useNavigate();
  const categories = useCategories(book.id);
  const [end, setEnd] = useState(currentMonth);
  const [range, setRange] = useState<Range>(12);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const trends = useQuery({
    queryKey: ['book', book.id, 'trends', end, range],
    queryFn: () => api.get<TrendsDTO>(`/books/${book.id}/trends?end=${end}&months=${range}`),
    placeholderData: (prev) => prev,
  });
  const from = shiftMonth(end, -(range - 1));
  const people = useQuery({
    queryKey: ['book', book.id, 'reports', 'people', from, end],
    queryFn: () => api.get<PeopleReportDTO>(`/books/${book.id}/reports/people?from=${from}&to=${end}`),
    enabled: book.memberCount > 1,
    placeholderData: (prev) => prev,
  });
  const money = (n: number) => formatMoney(n, book.currency);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const data = trends.data?.months ?? [];
  const totalIn = data.reduce((s, m) => s + m.income, 0);
  const totalOut = data.reduce((s, m) => s + m.expense, 0);
  const active = data.filter((m) => m.income || m.expense);
  const max = Math.max(...data.map((m) => Math.max(m.income, m.expense)), 1);
  const barHeight = (v: number, top = max) => (v > 0 ? `max(2px, ${(v / top) * 100}%)` : '0');
  const savingsRate = totalIn > 0 ? Math.round(((totalIn - totalOut) / totalIn) * 100) : null;
  const [grouped, setGrouped] = useState(true);
  // Sub-categories can be added into their main category, or listed on their own.
  const rows = (trends.data?.byCategory ?? []).map((c) => {
    const parent = grouped ? byId.get(c.categoryId)?.parentId : null;
    return { categoryId: parent && byId.has(parent) ? parent : c.categoryId, totals: c.totals };
  });
  const merged = new Map<string, number[]>();
  for (const r of rows) {
    const sum = merged.get(r.categoryId) ?? r.totals.map(() => 0);
    merged.set(r.categoryId, sum.map((v, i) => v + (r.totals[i] ?? 0)));
  }
  const byCategory = [...merged.entries()]
    .map(([categoryId, totals]) => ({ categoryId, totals, total: totals.reduce((s, v) => s + v, 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const hasSubcategories = (categories.data ?? []).some((c) => c.parentId);
  const topCategory = Math.max(...byCategory.map((c) => c.total), 1);
  const focus = byCategory.find((c) => c.categoryId === focusCategory) ?? null;
  const focusMax = focus ? Math.max(...focus.totals, 1) : 1;
  const hoverMonth = data.find((m) => m.month === hovered);

  return (
    <div className="space-y-5">
      <PageTitle tab action={<MonthSwitcher month={end} onChange={setEnd} />}>
        Reports
      </PageTitle>
      <div className="flex items-center gap-2">
        <Segmented
          className="flex-1"
          value={String(range) as `${Range}`}
          onChange={(v) => setRange(Number(v) as Range)}
          options={[
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
            { value: '24', label: '2 years' },
          ]}
        />
        {can('book.export') && (
          <button onClick={() => setExporting(true)} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-label font-medium text-accent hover:bg-subtle">
            <Download className="size-4" /> Export
          </button>
        )}
      </div>
      <ErrorBanner error={trends.error ?? people.error} />

      {!trends.data ? (
        <PageSkeleton />
      ) : active.length === 0 ? (
        <Card>
          <EmptyState icon={<ChartColumn className="size-5" />} title="Nothing to report yet">
            Reports fill in as transactions are added.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <p className="text-label font-medium text-muted">
              {short(from)} {from.slice(0, 4)} – {short(end)} {end.slice(0, 4)}
            </p>
            <StatRow
              className="mt-2"
              items={[
                { label: 'Income', value: money(totalIn) },
                { label: 'Spent', value: money(totalOut) },
                { label: totalIn - totalOut < 0 ? 'Short' : 'Saved', value: `${money(Math.abs(totalIn - totalOut))}${savingsRate !== null && savingsRate > 0 ? ` · ${savingsRate}%` : ''}` },
              ]}
            />

            <div className="mt-4 flex justify-end gap-3 text-caption text-muted" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-income" /> Income
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-chart-expense" /> Spent
              </span>
            </div>
            <div className="mt-2 flex h-32 items-stretch gap-0.5 border-b border-line" onMouseLeave={() => setHovered(null)}>
              {data.map((m) => (
                <button
                  key={m.month}
                  onClick={() => navigate(m.month === currentMonth() ? '/' : `/budget?month=${m.month}`)}
                  onMouseEnter={() => setHovered(m.month)}
                  onFocus={() => setHovered(m.month)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${monthLabel(m.month)}: income ${money(m.income)}, spent ${money(m.expense)}`}
                  className={`flex flex-1 items-end justify-center gap-[2px] rounded-t-md px-0.5 ${hovered === m.month ? 'bg-subtle' : ''}`}
                >
                  <span className="w-full max-w-3 rounded-t-[4px] bg-chart-income" style={{ height: barHeight(m.income) }} />
                  <span className="w-full max-w-3 rounded-t-[4px] bg-chart-expense" style={{ height: barHeight(m.expense) }} />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-0.5" aria-hidden>
              {data.map((m, i) => (
                <span key={m.month} className="flex-1 text-center text-micro text-muted">
                  {range <= 12 || i % 3 === 0 ? short(m.month) : ''}
                </span>
              ))}
            </div>
            <p className="mt-3 min-h-5 text-label text-muted tabular" aria-live="polite">
              {hoverMonth ? (
                <>
                  <span className="font-semibold text-ink">{monthLabel(hoverMonth.month)}</span> · In {money(hoverMonth.income)} · Spent {money(hoverMonth.expense)} ·{' '}
                  {hoverMonth.income - hoverMonth.expense < 0 ? '−' : '+'}
                  {money(Math.abs(hoverMonth.income - hoverMonth.expense))}
                </>
              ) : (
                `Average spending ${money(Math.round(totalOut / Math.max(1, active.length) / 100) * 100)} a month. Tap a month to open it.`
              )}
            </p>
          </Card>

          {/* The same numbers as a table, for reading exact figures. */}
          <section>
            <SectionTitle>Month by month</SectionTitle>
            <Card className="overflow-x-auto">
              <table className="w-full text-label tabular">
                <thead>
                  <tr className="border-b border-line text-caption text-muted">
                    <th className="px-4 py-2 text-left font-medium">Month</th>
                    <th className="px-2 py-2 text-right font-medium">In</th>
                    <th className="px-2 py-2 text-right font-medium">Spent</th>
                    <th className="px-4 py-2 text-right font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...data].reverse().map((m) => (
                    <tr key={m.month}>
                      <td className="px-4 py-2">{monthLabel(m.month)}</td>
                      <td className="px-2 py-2 text-right">{m.income ? money(m.income) : '—'}</td>
                      <td className="px-2 py-2 text-right">{m.expense ? money(m.expense) : '—'}</td>
                      <td className={`px-4 py-2 text-right ${m.income - m.expense < 0 ? 'text-negative' : ''}`}>
                        {m.income || m.expense ? `${m.income - m.expense < 0 ? '−' : ''}${money(Math.abs(m.income - m.expense))}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {byCategory.length > 0 && (
            <section>
              <SectionTitle
                action={
                  hasSubcategories && (
                    <button onClick={() => setGrouped(!grouped)} className="text-label font-medium text-accent">
                      {grouped ? 'Show sub-categories' : 'Group into main categories'}
                    </button>
                  )
                }
              >
                Where it went
              </SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {byCategory.slice(0, 15).map((c) => {
                  const cat = byId.get(c.categoryId);
                  const open = focusCategory === c.categoryId;
                  return (
                    <div key={c.categoryId}>
                      <button
                        onClick={() => setFocusCategory(open ? null : c.categoryId)}
                        aria-expanded={open}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60"
                      >
                        <CategoryTile category={cat} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex justify-between gap-2 text-label">
                            <span className="truncate font-medium">{cat?.name ?? 'Unknown'}</span>
                            <span className="shrink-0 tabular">
                              {money(c.total)} <span className="text-muted">· {Math.round((c.total / Math.max(1, totalOut)) * 100)}%</span>
                            </span>
                          </span>
                          <span className="mt-1.5 block h-1.5 rounded-full bg-subtle">
                            <span className="block h-full rounded-full bg-chart-expense" style={{ width: `${(c.total / topCategory) * 100}%` }} />
                          </span>
                        </span>
                      </button>
                      {open && focus && (
                        <div className="px-4 pt-1 pb-4">
                          <p className="mb-2 text-caption text-muted">
                            {cat?.name ?? 'This category'} each month · average {money(Math.round(c.total / Math.max(1, focus.totals.filter((v) => v > 0).length) / 100) * 100)}
                          </p>
                          <div className="flex h-20 items-end gap-0.5 border-b border-line">
                            {focus.totals.map((v, i) => (
                              <span
                                key={data[i]!.month}
                                title={`${monthLabel(data[i]!.month)}: ${money(v)}`}
                                aria-label={`${monthLabel(data[i]!.month)}: ${money(v)}`}
                                className="flex h-full flex-1 items-end justify-center"
                              >
                                <span className="w-full max-w-4 rounded-t-[4px] bg-chart-expense" style={{ height: barHeight(v, focusMax) }} />
                              </span>
                            ))}
                          </div>
                          <div className="mt-1 flex gap-0.5" aria-hidden>
                            {data.map((m, i) => (
                              <span key={m.month} className="flex-1 text-center text-micro text-muted">
                                {range <= 12 || i % 3 === 0 ? short(m.month) : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
              <p className="mt-2 px-0.5 text-caption text-muted">Tap a category to see it month by month.</p>
            </section>
          )}

          {book.memberCount > 1 && people.data && (
            <section>
              <SectionTitle>By person</SectionTitle>
              <Card className="space-y-4 p-4">
                <div>
                  <p className="mb-2 text-caption font-medium text-muted">Added by</p>
                  <div className="space-y-2">
                    {people.data.addedBy.map((p) => (
                      <div key={p.userId}>
                        <p className="flex justify-between gap-2 text-label">
                          <span className="truncate">{p.name}</span>
                          <span className="shrink-0 tabular">
                            {money(p.expense)} spent <span className="text-muted">· {p.count} entries</span>
                          </span>
                        </p>
                        <span className="mt-1 block h-1.5 rounded-full bg-subtle">
                          <span className="block h-full rounded-full bg-chart-expense" style={{ width: `${(p.expense / Math.max(1, ...people.data.addedBy.map((x) => x.expense))) * 100}%` }} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {people.data.forWhom.some((f) => f.userId) && (
                  <div>
                    <p className="mb-2 text-caption font-medium text-muted">Spent for</p>
                    <div className="space-y-1.5">
                      {people.data.forWhom.map((f) => (
                        <p key={f.userId ?? 'none'} className="flex justify-between gap-2 text-label">
                          <span className={`truncate ${f.userId ? '' : 'text-muted'}`}>{f.name}</span>
                          <span className="shrink-0 tabular">{money(f.expense)}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </section>
          )}
        </>
      )}
      <ExportSheet open={exporting} onClose={() => setExporting(false)} preset={{ what: 'everything', period: 'range', month: end }} />
    </div>
  );
}
