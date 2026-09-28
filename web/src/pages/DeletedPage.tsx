import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { DELETED_RETENTION_DAYS, type DeletedTransactionDTO } from '@ffos/shared';
import { Amount, PageTitle } from '../components/AppShell.tsx';
import { CategoryTile } from '../components/CategoryIcon.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { Button, Card, EmptyState, ErrorBanner, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';
import { dayLabel, relativeTime } from '../lib/format.ts';

function daysLeft(purgeAt: string) {
  return Math.max(0, Math.ceil((Date.parse(purgeAt) - Date.now()) / 86_400_000));
}

export function DeletedPage() {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useCategories(book.id);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const deleted = useQuery({
    queryKey: ['book', book.id, 'deleted'],
    queryFn: () => api.get<DeletedTransactionDTO[]>(`/books/${book.id}/transactions/deleted`),
    enabled: can('txn.delete.own'),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/books/${book.id}/transactions/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      toast({ message: 'Transaction restored', duration: 2500 });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : "Couldn't restore" }),
  });

  return (
    <div className="space-y-5">
      <Link to="/transactions" className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Transactions
      </Link>
      <PageTitle
        subtitle={`Deleted transactions are removed permanently after ${DELETED_RETENTION_DAYS} days.${
          can('txn.delete.any') ? '' : ' You can see the ones you added.'
        }`}
      >
        Recently deleted
      </PageTitle>

      <ErrorBanner error={deleted.error} />
      {deleted.isLoading ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : !deleted.data?.length ? (
        <Card>
          <EmptyState icon={<Trash2 className="size-5" />} title="Nothing here">
            Deleted transactions appear here for {DELETED_RETENTION_DAYS} days.
          </EmptyState>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {deleted.data.map((t) => {
            const category = byId.get(t.categoryId);
            const left = daysLeft(t.purgeAt);
            return (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                <CategoryTile category={category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{t.note || category?.name || 'Transaction'}</p>
                  <p className="text-[13px] text-muted">
                    {dayLabel(t.date)} · deleted by {t.deletedByName} {relativeTime(t.deletedAt)}
                  </p>
                  <p className={`mt-0.5 text-xs ${left <= 3 ? 'text-negative' : 'text-muted'}`}>
                    {left === 0 ? 'Removed today' : `${left} day${left === 1 ? '' : 's'} left`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Amount txn={t} currency={book.currency} className="text-[15px]" />
                  <Button
                    variant="secondary"
                    className="min-h-8! px-2.5 text-[13px]"
                  loading={restore.isPending && restore.variables === t.id}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(t.id)}
                  aria-label={`Restore ${t.note || category?.name || 'transaction'}`}
                >
                    <RotateCcw className="size-3.5" /> Restore
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
