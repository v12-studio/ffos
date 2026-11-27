import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, Merge, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { isCatchAllCategory, type CategoryDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { CATEGORY_COLORS, CategoryTile, ICON_KEYS, iconFor } from '../components/CategoryIcon.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { useCategories } from '../components/TransactionSheet.tsx';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';
import { useToast } from '../components/Toast.tsx';
import { Button, Card, EmptyState, ErrorBanner, Field, fieldErrors, inputClass, PageSkeleton, SectionTitle, Segmented, Sheet } from '../components/ui.tsx';
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
  // Sub-categories are listed under their parent; one whose parent is hidden shows at the top level.
  const liveIds = new Set(live.map((c) => c.id));
  const tops = live.filter((c) => !c.parentId || !liveIds.has(c.parentId));
  const childrenOf = (id: string) => live.filter((c) => c.parentId === id);
  /** Every live id in display order, optionally with one parent's children in a new order. */
  const flatten = (order: CategoryDTO[], parent?: string, kids?: CategoryDTO[]) =>
    order.flatMap((t) => [t.id, ...(t.id === parent && kids ? kids : childrenOf(t.id)).map((k) => k.id)]);
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
        <PageSkeleton />
      ) : (
        <>
          <section>
            <SectionTitle
              action={
                canManage && (
                  <button onClick={() => setEditing('new')} className="flex items-center gap-1 text-label font-medium text-accent">
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
              <Card className="overflow-hidden">
                <SortableList
                  className="divide-y divide-line"
                  items={tops}
                  keyOf={(c) => c.id}
                  onMove={(from, to) => reorder.mutate(flatten(moveItem(tops, from, to)))}
                  renderItem={(c, handle) => {
                    const kids = childrenOf(c.id);
                    return (
                      <div>
                        <div className={`flex min-h-14 items-center gap-1 ${canManage ? 'pl-3' : ''}`}>
                          {canManage && <DragHandle handle={handle} label={c.name} />}
                          <button
                            onClick={() => canManage && setEditing(c)}
                            disabled={!canManage}
                            className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left hover:bg-subtle/60 disabled:hover:bg-transparent"
                          >
                            <CategoryTile category={c} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-body font-medium">{c.name}</span>
                              {kids.length > 0 && <span className="block text-caption text-muted">{kids.length} inside</span>}
                            </span>
                          </button>
                        </div>
                        {kids.length > 0 && (
                          <SortableList
                            className="divide-y divide-line border-t border-line bg-subtle/30"
                            items={kids}
                            keyOf={(k) => k.id}
                            onMove={(from, to) => reorder.mutate(flatten(tops, c.id, moveItem(kids, from, to)))}
                            renderItem={(k, kidHandle) => (
                              <div className={`flex min-h-12 items-center gap-1 pl-10 ${canManage ? '' : 'pl-12'}`}>
                                {canManage && <DragHandle handle={kidHandle} label={k.name} />}
                                <button
                                  onClick={() => canManage && setEditing(k)}
                                  disabled={!canManage}
                                  className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 text-left hover:bg-subtle/60 disabled:hover:bg-transparent"
                                >
                                  <CategoryTile category={k} size="sm" />
                                  <span className="min-w-0 flex-1 truncate text-body">{k.name}</span>
                                </button>
                              </div>
                            )}
                          />
                        )}
                      </div>
                    );
                  }}
                />
              </Card>
            )}
            <p className="mt-2 px-0.5 text-label text-muted">{canManage ? 'Hold ⠿ and drag to reorder. ' : ''}This is the order they appear in when adding an entry.</p>
          </section>

          {hidden.length > 0 && (
            <section>
              <SectionTitle>Hidden</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {hidden.map((c) => (
                  <div key={c.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <CategoryTile category={c} />
                    <span className="min-w-0 flex-1 truncate text-body text-muted">{c.name}</span>
                    {canManage && (
                      <Button
                        variant="secondary"
                        className="min-h-9! px-3 text-label"
                        loading={unhide.isPending && unhide.variables?.id === c.id}
                        onClick={() => unhide.mutate(c)}
                      >
                        Unhide
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
              <p className="mt-2 px-0.5 text-label text-muted">Past entries keep these categories; they just aren't offered for new ones.</p>
            </section>
          )}
        </>
      )}

      <CategorySheet key={editing === 'new' ? `new-${kind}` : editing?.id ?? 'none'} editing={editing} kind={kind} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategorySheet({ editing, kind, onClose }: { editing: CategoryDTO | 'new' | null; kind: Kind; onClose: () => void }) {
  const { book } = useCurrentBook();
  const allCategories = useCategories(book.id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const existing = editing && editing !== 'new' ? editing : null;
  const [form, setForm] = useState({
    parentId: existing?.parentId ?? '',
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
            ...((form.parentId || null) !== existing.parentId ? { parentId: form.parentId || null } : {}),
          })
        : api.post<CategoryDTO>(`/books/${book.id}/categories`, {
            name: form.name,
            icon: form.icon,
            color: form.color,
            kind,
            ...(form.parentId ? { parentId: form.parentId } : {}),
          }),
    onSuccess: done,
  });
  const hide = useMutation({
    mutationFn: () => api.patch<CategoryDTO>(`/books/${book.id}/categories/${existing!.id}`, { archived: true }),
    onSuccess: () => {
      toast({ message: `${existing!.name} hidden. Unhide it any time from this page.`, duration: 3000 });
      done();
    },
  });
  const confirm = useConfirm();
  const [mergeInto, setMergeInto] = useState('');
  const merge = useMutation({
    mutationFn: () => api.post<{ moved: number }>(`/books/${book.id}/categories/${existing!.id}/merge`, { into: mergeInto }),
    onSuccess: (res) => {
      // Entries, budgets and repeating entries all changed.
      queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      toast({ message: `Merged: ${res.moved} transaction${res.moved === 1 ? '' : 's'} moved`, duration: 3000 });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/books/${book.id}/categories/${existing!.id}`),
    onSuccess: () => {
      toast({ message: `${existing!.name} deleted`, duration: 2500 });
      done();
    },
  });
  const hasKids = existing ? (allCategories.data ?? []).some((c) => c.parentId === existing.id) : false;
  const parentChoices = (allCategories.data ?? []).filter((c) => c.kind === kind && !c.archived && !c.parentId && c.id !== existing?.id && !isCatchAllCategory(c));
  const mergeTargets = (allCategories.data ?? []).filter((c) => existing && c.kind === existing.kind && c.id !== existing.id && !c.archived);
  const errors = fieldErrors(save.error);
  const locked = existing ? isCatchAllCategory(existing) : false;
  const preview: CategoryDTO = { id: 'preview', name: form.name, kind, icon: form.icon, color: form.color, archived: false, group: 'spending', section: 'spending', memberId: null, goal: null, rollover: false, parentId: null };

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

        {!locked && (
          <label className="block">
            <span className="mb-1.5 block text-label font-medium">Inside (optional)</span>
            <select
              value={form.parentId}
              disabled={hasKids}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className={inputClass}
            >
              <option value="">Nothing: a main category</option>
              {parentChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-caption text-muted">
              {hasKids ? 'It has categories inside it, so it stays a main category.' : 'e.g. Milk and Vegetables inside Groceries. Each still has its own budget.'}
            </span>
          </label>
        )}

        <fieldset>
          <legend className="mb-2 text-label font-medium">Icon</legend>
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
          <legend className="mb-2 text-label font-medium">Colour</legend>
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

        <ErrorBanner error={Object.keys(errors).length ? null : (save.error ?? hide.error ?? merge.error ?? remove.error)} />
        <Button type="submit" className="w-full" disabled={!form.name.trim()} loading={save.isPending}>
          {existing ? 'Save' : 'Add category'}
        </Button>
        {existing && !locked && (
          <div className="space-y-3 border-t border-line pt-5">
            <Button type="button" variant="danger" className="w-full" loading={hide.isPending} onClick={() => hide.mutate()}>
              <EyeOff className="size-4" /> Hide category
            </Button>
            <div>
              <p className="mb-1.5 text-label font-medium">Merge into another category</p>
              <div className="flex gap-2">
                <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${inputClass} min-w-0 flex-1`} aria-label="Merge into">
                  <option value="">Pick a category…</option>
                  {mergeTargets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!mergeInto}
                  loading={merge.isPending}
                  onClick={async () => {
                    const target = mergeTargets.find((c) => c.id === mergeInto)!;
                    const ok = await confirm({
                      title: `Merge ${existing.name} into ${target.name}?`,
                      message: `Every transaction, repeating entry and budget amount in ${existing.name} moves to ${target.name}, and ${existing.name} is removed. This can't be undone.`,
                      confirmLabel: 'Merge',
                      danger: true,
                    });
                    if (ok) merge.mutate();
                  }}
                >
                  <Merge className="size-4" /> Merge
                </Button>
              </div>
              <p className="mt-1.5 text-caption text-muted">For two categories that mean the same thing, like "Veg" and "Vegetables".</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-negative"
              loading={remove.isPending}
              onClick={async () => {
                const ok = await confirm({ title: `Delete ${existing.name}?`, message: 'Only categories nothing uses can be deleted.', confirmLabel: 'Delete', danger: true });
                if (ok) remove.mutate();
              }}
            >
              <Trash2 className="size-4" /> Delete (only if unused)
            </Button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
