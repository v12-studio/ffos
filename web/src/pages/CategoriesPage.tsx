import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, EyeOff, Plus, Tags } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { isCatchAllCategory, type CategoryDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CATEGORY_COLORS, CategoryTile, ICON_KEYS, iconFor } from '../components/CategoryIcon.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, EmptyState, ErrorBanner, Field, fieldErrors, SectionTitle, Segmented, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useCurrentBook } from '../lib/book.tsx';

type Kind = 'expense' | 'income';

export function CategoriesPage() {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useCategories(book.id);
  const [kind, setKind] = useState<Kind>('expense');
  const [editing, setEditing] = useState<CategoryDTO | 'new' | null>(null);
  const canManage = can('setup.manage');
  const key = ['book', book.id, 'categories'];

  const all = categories.data ?? [];
  const live = all.filter((c) => c.kind === kind && !c.archived);
  const hidden = all.filter((c) => c.kind === kind && c.archived);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put<CategoryDTO[]>(`/books/${book.id}/categories/order`, { kind, ids }),
    onMutate: (ids) => {
      // Move rows immediately; the server's answer replaces this.
      const previous = queryClient.getQueryData<CategoryDTO[]>(key);
      const pos = new Map(ids.map((id, i) => [id, i]));
      queryClient.setQueryData<CategoryDTO[]>(key, (list = []) =>
        [...list].sort((a, b) => (a.kind === b.kind && pos.has(a.id) && pos.has(b.id) ? pos.get(a.id)! - pos.get(b.id)! : 0)),
      );
      return { previous };
    },
    onError: (_err, _ids, ctx) => ctx?.previous && queryClient.setQueryData(key, ctx.previous),
    onSuccess: (list) => queryClient.setQueryData(key, list),
  });

  const unhide = useMutation({
    mutationFn: (c: CategoryDTO) => api.patch<CategoryDTO>(`/books/${book.id}/categories/${c.id}`, { archived: false }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({ message: `${updated.name} is back in the list`, duration: 2500 });
    },
  });

  const move = (index: number, delta: number) => {
    const ids = live.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-6">
      <PageTitle subtitle={canManage ? 'Rename, recolour, reorder or hide categories' : 'Only owners and admins can change categories'}>
        Categories
      </PageTitle>

      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
      />

      <ErrorBanner error={categories.error ?? reorder.error ?? unhide.error} />

      {categories.isLoading ? (
        <div className="grid h-40 place-items-center text-muted">
          <Spinner />
        </div>
      ) : (
        <>
          <section>
            <SectionTitle
              action={
                canManage && (
                  <button onClick={() => setEditing('new')} className="flex items-center gap-1 text-[13px] font-medium text-accent">
                    <Plus className="size-3.5" /> Add
                  </button>
                )
              }
            >
              Shown when adding entries
            </SectionTitle>
            {live.length === 0 ? (
              <Card>
                <EmptyState icon={<Tags className="size-5" />} title="No categories" />
              </Card>
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {live.map((c, i) => (
                  <div key={c.id} className="flex min-h-14 items-center gap-1 pr-2">
                    <button
                      onClick={() => canManage && setEditing(c)}
                      disabled={!canManage}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 text-left hover:bg-subtle/60 disabled:hover:bg-transparent"
                    >
                      <CategoryTile category={c} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
                    </button>
                    {canManage && (
                      <>
                        <IconButton label={`Move ${c.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                          <ArrowUp className="size-4" />
                        </IconButton>
                        <IconButton
                          label={`Move ${c.name} down`}
                          disabled={i === live.length - 1 || reorder.isPending}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown className="size-4" />
                        </IconButton>
                      </>
                    )}
                  </div>
                ))}
              </Card>
            )}
            <p className="mt-2 px-0.5 text-[13px] text-muted">This is the order they appear in when adding an entry.</p>
          </section>

          {hidden.length > 0 && (
            <section>
              <SectionTitle>Hidden</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {hidden.map((c) => (
                  <div key={c.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <CategoryTile category={c} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{c.name}</span>
                    {canManage && (
                      <Button
                        variant="secondary"
                        className="min-h-9! px-3 text-sm"
                        loading={unhide.isPending && unhide.variables?.id === c.id}
                        onClick={() => unhide.mutate(c)}
                      >
                        Unhide
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
              <p className="mt-2 px-0.5 text-[13px] text-muted">Past entries keep these categories; they just aren't offered for new ones.</p>
            </section>
          )}
        </>
      )}

      <CategorySheet key={editing === 'new' ? `new-${kind}` : editing?.id ?? 'none'} editing={editing} kind={kind} onClose={() => setEditing(null)} />
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function CategorySheet({ editing, kind, onClose }: { editing: CategoryDTO | 'new' | null; kind: Kind; onClose: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = editing && editing !== 'new' ? editing : null;
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    icon: existing?.icon && ICON_KEYS.includes(existing.icon) ? existing.icon : 'tag',
    color: existing?.color ?? CATEGORY_COLORS[0]!,
  });
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['book', book.id, 'categories'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.patch<CategoryDTO>(`/books/${book.id}/categories/${existing.id}`, {
            ...(isCatchAllCategory(existing) ? {} : { name: form.name }),
            icon: form.icon,
            color: form.color,
          })
        : api.post<CategoryDTO>(`/books/${book.id}/categories`, { ...form, kind }),
    onSuccess: done,
  });
  const hide = useMutation({
    mutationFn: () => api.patch<CategoryDTO>(`/books/${book.id}/categories/${existing!.id}`, { archived: true }),
    onSuccess: () => {
      toast({ message: `${existing!.name} hidden. Unhide it any time from this page.`, duration: 3000 });
      done();
    },
  });
  const errors = fieldErrors(save.error);
  const locked = existing ? isCatchAllCategory(existing) : false;
  const preview: CategoryDTO = { id: 'preview', name: form.name, kind, icon: form.icon, color: form.color, archived: false };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={existing ? `Edit ${existing.name}` : `New ${kind} category`}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex items-end gap-3">
          <CategoryTile category={preview} />
          <Field
            className="min-w-0 flex-1"
            label="Name"
            value={form.name}
            maxLength={40}
            disabled={locked}
            hint={locked ? `"${existing!.name}" keeps its name so it always works as the fallback` : undefined}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus={!existing}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Icon</legend>
          <div className="grid grid-cols-8 gap-1.5">
            {ICON_KEYS.map((key) => {
              const Icon = iconFor(key);
              const on = form.icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm({ ...form, icon: key })}
                  aria-label={key}
                  aria-pressed={on}
                  className={`grid aspect-square place-items-center rounded-lg border ${on ? 'border-primary bg-primary text-primary-fg' : 'border-line hover:bg-subtle'}`}
                >
                  <Icon className="size-4.5" strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Colour</legend>
          <div className="grid grid-cols-7 gap-2">
            {CATEGORY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setForm({ ...form, color })}
                aria-label={`Colour ${color}`}
                aria-pressed={form.color === color}
                className="grid aspect-square place-items-center rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-ink"
                style={{ backgroundColor: color }}
              >
                {form.color === color && <Check className="size-4 text-white" strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        </fieldset>

        <ErrorBanner error={Object.keys(errors).length ? null : (save.error ?? hide.error)} />
        <Button type="submit" className="w-full" disabled={!form.name.trim()} loading={save.isPending}>
          {existing ? 'Save' : 'Add category'}
        </Button>
        {existing && !locked && (
          <Button type="button" variant="danger" className="w-full" loading={hide.isPending} onClick={() => hide.mutate()}>
            <EyeOff className="size-4" /> Hide category
          </Button>
        )}
      </form>
    </Sheet>
  );
}
