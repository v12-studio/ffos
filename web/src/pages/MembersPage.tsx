import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Crown, History, Lock, LogOut, Share2, Trash2, UserPlus, X } from 'lucide-react';
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
import { Avatar, Button, Card, ErrorBanner, Field, fieldErrors, RoleBadge, SectionTitle, Sheet, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { relativeTime } from '../lib/format.ts';

export function MembersPage() {
  const { book, can } = useCurrentBook();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<MemberDTO | null>(null);
  const members = useQuery({
    queryKey: ['book', book.id, 'members'],
    queryFn: () => api.get<MemberDTO[]>(`/books/${book.id}/members`),
  });
  const canInvite = can('members.invite') && !book.isPersonal;

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
          <p className="text-sm text-muted">
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
                  <span className="block truncate text-[15px] font-medium">
                    {m.name}
                    {m.userId === user!.id && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="block text-xs text-muted tabular">{m.phone}</span>
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
      {can('activity.view') && <ActivityFeed />}
      <BookSettings />

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
            <span className="block text-sm text-muted">{ROLE_LABELS[r].description}</span>
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
          <p className="text-sm text-muted">
            Send this link to the person you're inviting. It works once and expires in 7 days
            {create.data.phone ? `, only for ${create.data.phone}` : ''}.
          </p>
          <div className="rounded-lg border border-line bg-subtle/60 p-3 font-mono text-[13px] break-all">{link}</div>
          {'share' in navigator && (
            <Button className="w-full" onClick={() => navigator.share({ title: `Join ${book.name}`, text: message }).catch(() => undefined)}>
              <Share2 className="size-4" /> Share via WhatsApp, SMS…
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
            onClick={() => {
              if (confirm(`Make ${member.name} the owner of "${book.name}"? You'll become an admin.`)) transfer.mutate();
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
            onClick={() => {
              if (confirm(`Remove ${member.name} from "${book.name}"? They'll lose access immediately.`)) remove.mutate();
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
            <span className="min-w-0 flex-1 text-sm">
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
  const [expanded, setExpanded] = useState(false);
  const activity = useQuery({
    queryKey: ['book', book.id, 'activity'],
    queryFn: () => api.get<ActivityDTO[]>(`/books/${book.id}/activity`),
    refetchInterval: 60_000,
  });
  const rows = activity.data ?? [];
  if (!rows.length) return null;
  const visible = expanded ? rows : rows.slice(0, 5);

  return (
    <section>
      <SectionTitle>Activity</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {visible.map((a) => (
          <div key={a.id} className="flex gap-3 px-4 py-3 text-sm">
            <History className="mt-0.5 size-4 shrink-0 text-muted" />
            <p className="min-w-0 flex-1">
              <strong>{a.userName}</strong> {a.summary}
            </p>
            <span className="shrink-0 text-xs text-muted">{relativeTime(a.at)}</span>
          </div>
        ))}
        {rows.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="min-h-11 w-full text-sm font-medium text-accent">
            {expanded ? 'Show less' : `Show all ${rows.length}`}
          </button>
        )}
      </Card>
    </section>
  );
}

function BookSettings() {
  const { book, can } = useCurrentBook();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: book.name, currency: book.currency });
  const [forBook, setForBook] = useState(book.id);
  if (forBook !== book.id) {
    setForBook(book.id);
    setForm({ name: book.name, currency: book.currency });
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['books'] });
  const save = useMutation({ mutationFn: () => api.patch(`/books/${book.id}`, form), onSuccess: refresh });
  const leave = useMutation({ mutationFn: () => api.post(`/books/${book.id}/leave`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.del(`/books/${book.id}`), onSuccess: refresh });
  const errors = fieldErrors(save.error);
  const dirty = form.name !== book.name || form.currency !== book.currency;
  const canLeave = book.role !== 'owner';
  const canDelete = can('book.delete') && !book.isPersonal;

  if (!can('book.settings') && !canLeave && !canDelete) return null;

  return (
    <section>
      <SectionTitle>Book</SectionTitle>
      <Card className="space-y-4 p-4">
        {can('book.settings') && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Currency" maxLength={3} value={form.currency} error={errors.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
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
            onClick={() => confirm(`Leave "${book.name}"? You'll need a new invite to rejoin.`) && leave.mutate()}
          >
            <LogOut className="size-4" /> Leave book
          </Button>
        )}
        {canDelete && (
          <Button
            variant="danger"
            className="w-full"
            loading={remove.isPending}
            onClick={() => confirm(`Delete "${book.name}" for all members? This can't be undone from the app.`) && remove.mutate()}
          >
            <Trash2 className="size-4" /> Delete book
          </Button>
        )}
      </Card>
    </section>
  );
}
