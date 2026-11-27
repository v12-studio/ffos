import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Crown, Download, History, Lock, MessageCircle, Settings2, Share2, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import {
  ASSIGNABLE_ROLES,
  canManageMember,
  ROLE_LABELS,
  type ActivityDTO,
  type AssignableRole,
  type InviteCreatedDTO,
  type InviteDTO,
  type MemberDTO,
  type Role,
} from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { PhoneField } from '../components/auth-ui.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { BookSettings } from '../components/BookSettings.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { Avatar, Button, Card, ErrorBanner, fieldErrors, inputClass, ListRow, RoleBadge, SectionTitle, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { relativeTime } from '../lib/format.ts';

export function MembersPage() {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<MemberDTO | null>(null);
  const [panel, setPanel] = useState<'activity' | 'export' | 'book' | null>(null);
  const closePanel = () => setPanel(null);
  const members = useQuery({
    queryKey: ['book', book.id, 'members'],
    queryFn: () => api.get<MemberDTO[]>(`/books/${book.id}/members`),
  });
  const canInvite = can('members.invite') && !book.isPersonal;
  const canBookSettings = can('book.settings') || book.role !== 'owner' || (can('book.delete') && !book.isPersonal);

  const isTappable = (m: MemberDTO) =>
    m.userId !== user!.id &&
    (canManageMember(book.role, { role: m.role, isSelf: false }) || (can('book.transfer') && !book.isPersonal));

  return (
    <div className="space-y-6">
      <PageTitle
        action={
          canInvite && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" /> Invite
            </Button>
          )
        }
      >
        Members
      </PageTitle>

      {book.isPersonal && (
        <Card className="flex gap-3 p-4">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted" />
          <p className="text-label text-muted">
            <strong className="font-semibold text-ink">Personal is private to you.</strong> To share expenses with
            family, tap the book name at the top and create a new book, then invite people to it.
          </p>
        </Card>
      )}

      <section>
        <SectionTitle>{members.data ? `${members.data.length} member${members.data.length === 1 ? '' : 's'}` : 'Members'}</SectionTitle>
        <ErrorBanner error={members.error} />
        <Card className="divide-y divide-line overflow-hidden">
          {members.isLoading && (
            <div className="grid h-20 place-items-center text-muted">
              <Spinner />
            </div>
          )}
          {members.data?.map((m) => {
            const tappable = isTappable(m);
            const content = (
              <>
                <Avatar name={m.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">
                    {m.name}
                    {m.userId === user!.id && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="block text-caption text-muted tabular">{m.phone}</span>
                </span>
                <RoleBadge role={m.role} />
              </>
            );
            return tappable ? (
              <button key={m.userId} onClick={() => setSelected(m)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60 active:bg-subtle">
                {content}
              </button>
            ) : (
              <div key={m.userId} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                {content}
              </div>
            );
          })}
        </Card>
      </section>

      {canInvite && <PendingInvites />}
      {(can('activity.view') || can('book.export') || canBookSettings) && (
        <section>
          <SectionTitle>Manage</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {can('activity.view') && <ListRow icon={History} title="Activity" detail="Who changed what in this book" onClick={() => setPanel('activity')} />}
            {can('book.export') && <ListRow icon={Download} title="Export" detail="Budget, transactions or everything · CSV, Excel, backup" onClick={() => setPanel('export')} />}
            {canBookSettings && <ListRow icon={Settings2} title="Book settings" detail={`${book.name} · ${book.currency}`} onClick={() => setPanel('book')} />}
          </Card>
        </section>
      )}

      <Sheet open={panel === 'activity'} onClose={closePanel} title="Activity">
        <ActivityFeed />
      </Sheet>
      <ExportSheet open={panel === 'export'} onClose={closePanel} preset={{ what: 'everything', period: 'all' }} />
      <Sheet open={panel === 'book'} onClose={closePanel} title="Book settings">
        <BookSettings onDone={closePanel} />
      </Sheet>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <MemberSheet member={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RolePicker({
  value,
  onChange,
  isAllowed = () => true,
}: {
  value: AssignableRole;
  onChange: (r: AssignableRole) => void;
  isAllowed?: (r: AssignableRole) => boolean;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Role">
      {ASSIGNABLE_ROLES.filter(isAllowed).map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left ${
            value === r ? 'border-primary bg-subtle ring-1 ring-primary' : 'border-line bg-surface hover:bg-subtle/60'
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{ROLE_LABELS[r].name}</span>
            <span className="block text-label text-muted">{ROLE_LABELS[r].description}</span>
          </span>
          {value === r && <Check className="size-4 shrink-0 text-ink" />}
        </button>
      ))}
    </div>
  );
}

function inviteLink(token: string) {
  return `${location.origin}${location.pathname}#/invite/${token}`;
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<AssignableRole>('contributor');
  const [phone, setPhone] = useState('+91');
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    // A bare country code means "no phone restriction".
    mutationFn: () =>
      api.post<InviteCreatedDTO>(`/books/${book.id}/invites`, { role, phone: /^\+\d{1,3}$/.test(phone) ? '' : phone }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', book.id, 'invites'] }),
  });
  const errors = fieldErrors(create.error);

  const close = () => {
    create.reset();
    setCopied(false);
    setPhone('+91');
    onClose();
  };

  if (create.data) {
    const link = inviteLink(create.data.token);
    const message = `Join "${book.name}" on Family Finance OS as ${ROLE_LABELS[create.data.role].name}: ${link}`;
    return (
      <Sheet open={open} onClose={close} title="Invite link ready">
        <div className="space-y-4">
          <p className="text-label text-muted">
            Send this link to the person you're inviting. It works once and expires in 7 days
            {create.data.phone ? `, only for ${create.data.phone}` : ''}.
          </p>
          <div className="rounded-lg border border-line bg-subtle/60 p-3 font-mono text-label break-all">{link}</div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body font-medium text-primary-fg hover:bg-primary/90"
          >
            <MessageCircle className="size-4" /> Send on WhatsApp
          </a>
          {'share' in navigator && (
            <Button variant="secondary" className="w-full" onClick={() => navigator.share({ title: `Join ${book.name}`, text: message }).catch(() => undefined)}>
              <Share2 className="size-4" /> Share another way
            </Button>
          )}
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await navigator.clipboard?.writeText(message).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={close}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={`Invite to ${book.name}`}>
      <div className="space-y-4">
        <RolePicker value={role} onChange={setRole} />
        <PhoneField label="Their phone (optional, restricts the link to them)" value={phone} error={errors.phone} onChange={setPhone} />
        <ErrorBanner error={Object.keys(errors).length ? null : create.error} />
        <Button className="w-full" loading={create.isPending} onClick={() => create.mutate()}>
          Create invite link
        </Button>
      </div>
    </Sheet>
  );
}

function MemberSheet({ member, onClose }: { member: MemberDTO | null; onClose: () => void }) {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [role, setRole] = useState<AssignableRole>('viewer');
  const [lastMember, setLastMember] = useState<string | null>(null);
  if (member && member.userId !== lastMember) {
    setLastMember(member.userId);
    if (member.role !== 'owner') setRole(member.role);
  }

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['book', book.id] });
    queryClient.invalidateQueries({ queryKey: ['books'] });
    onClose();
  };
  const update = useMutation({ mutationFn: () => api.patch(`/books/${book.id}/members/${member!.userId}`, { role }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api.del(`/books/${book.id}/members/${member!.userId}`), onSuccess: done });
  const transfer = useMutation({ mutationFn: () => api.post(`/books/${book.id}/transfer`, { userId: member!.userId }), onSuccess: done });

  if (!member) return null;
  const manageable = canManageMember(book.role, { role: member.role, isSelf: false });

  return (
    <Sheet open onClose={onClose} title={member.name}>
      <div className="space-y-4">
        <ErrorBanner error={update.error ?? remove.error ?? transfer.error} />
        {manageable && (
          <>
            <RolePicker value={role} onChange={setRole} isAllowed={(r) => canManageMember(book.role, { role: member.role, isSelf: false }, r as Role)} />
            <Button className="w-full" disabled={role === member.role} loading={update.isPending} onClick={() => update.mutate()}>
              Change role
            </Button>
          </>
        )}
        {can('book.transfer') && !book.isPersonal && (
          <Button
            variant="secondary"
            className="w-full"
            loading={transfer.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `Make ${member.name} the owner?`,
                message: `They'll own "${book.name}" and you'll become an admin.`,
                confirmLabel: 'Make owner',
              });
              if (ok) transfer.mutate();
            }}
          >
            <Crown className="size-4" /> Make owner
          </Button>
        )}
        {manageable && (
          <Button
            variant="danger"
            className="w-full"
            loading={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `Remove ${member.name}?`,
                message: `They'll lose access to "${book.name}" immediately.`,
                confirmLabel: 'Remove',
                danger: true,
              });
              if (ok) remove.mutate();
            }}
          >
            <Trash2 className="size-4" /> Remove from book
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function PendingInvites() {
  const { book } = useCurrentBook();
  const queryClient = useQueryClient();
  const invites = useQuery({
    queryKey: ['book', book.id, 'invites'],
    queryFn: () => api.get<InviteDTO[]>(`/books/${book.id}/invites`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/books/${book.id}/invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['book', book.id, 'invites'] }),
  });
  if (!invites.data?.length) return null;

  return (
    <section>
      <SectionTitle>Pending invites</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {invites.data.map((i) => (
          <div key={i.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 text-label">
              <span className="block font-medium">{i.phone ?? 'Anyone with the link'}</span>
              <span className="text-muted">
                by {i.createdByName} · expires {new Date(i.expiresAt).toLocaleDateString()}
              </span>
            </span>
            <RoleBadge role={i.role} />
            <button
              onClick={() => revoke.mutate(i.id)}
              className="grid size-10 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
              aria-label="Cancel invite"
            >
              <X className="size-5" />
            </button>
          </div>
        ))}
      </Card>
    </section>
  );
}

function ActivityFeed() {
  const { book } = useCurrentBook();
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('');
  const members = useQuery({ queryKey: ['book', book.id, 'members'], queryFn: () => api.get<MemberDTO[]>(`/books/${book.id}/members`) });
  const filters = new URLSearchParams({ ...(person ? { userId: person } : {}), ...(kind ? { entity: kind } : {}) });
  const activity = useInfiniteQuery({
    queryKey: ['book', book.id, 'activity', filters.toString()],
    queryFn: ({ pageParam }) => api.get<ActivityDTO[]>(`/books/${book.id}/activity?${filters}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    // A full page means there may be more before its last entry.
    getNextPageParam: (last) => (last.length === 50 ? last.at(-1)!.at : undefined),
    refetchInterval: 60_000,
  });
  const rows = activity.data?.pages.flat() ?? [];

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <select value={person} onChange={(e) => setPerson(e.target.value)} className={inputClass} aria-label="Who">
          <option value="">Everyone</option>
          {(members.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass} aria-label="What">
          <option value="">All changes</option>
          <option value="transaction">Transactions</option>
          <option value="budget">Budget</option>
          <option value="category">Categories</option>
          <option value="recurring">Repeating entries</option>
          <option value="member">Members</option>
          <option value="book">Book</option>
        </select>
      </div>
      {activity.isLoading ? (
        <div className="grid h-24 place-items-center text-muted">
          <Spinner />
        </div>
      ) : !rows.length ? (
        <p className="py-6 text-center text-label text-muted">No activity{person || kind ? ' matching that' : ' yet'}.</p>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((a) => (
            <div key={a.id} className="flex gap-3 px-4 py-3 text-label">
              <History className="mt-0.5 size-4 shrink-0 text-muted" />
              <p className="min-w-0 flex-1">
                <strong>{a.userName}</strong> {a.summary}
              </p>
              <span className="shrink-0 text-caption text-muted" title={new Date(a.at).toLocaleString()}>
                {relativeTime(a.at)}
              </span>
            </div>
          ))}
          {activity.hasNextPage && (
            <button onClick={() => activity.fetchNextPage()} disabled={activity.isFetchingNextPage} className="min-h-11 w-full text-label font-medium text-accent">
              {activity.isFetchingNextPage ? 'Loading…' : 'Show older'}
            </button>
          )}
        </Card>
      )}
      <p className="mt-2 px-0.5 text-caption text-muted">Kept for a year.</p>
    </>
  );
}
