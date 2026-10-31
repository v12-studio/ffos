import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockKeyhole, LogOut, Repeat, Smartphone, Tags, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import type { SessionDTO, UserDTO } from '@ffos/shared';
import { AppLockSettings, useAppLock } from '../components/AppLock.tsx';
import { PageTitle } from '../components/AppShell.tsx';
import { Avatar, Button, Card, ErrorBanner, Field, fieldErrors, ListRow, SectionTitle, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { relativeTime } from '../lib/format.ts';

type Panel = 'profile' | 'password' | 'devices' | 'lock' | null;

export function MorePage() {
  const { user, signOut } = useAuth();
  const { book, can } = useCurrentBook();
  const { config: lock } = useAppLock();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);
  return (
    <div className="space-y-6">
      <PageTitle>Settings</PageTitle>
      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          <ListRow
            leading={<Avatar name={user!.name} />}
            title={user!.name}
            detail={`${user!.phone}${user!.email ? ` · ${user!.email}` : ''}`}
            onClick={() => setPanel('profile')}
          />
          <ListRow icon={KeyRound} title="Password" detail="Change your password" onClick={() => setPanel('password')} />
          <ListRow icon={Smartphone} title="Signed-in devices" detail="See and sign out other devices" onClick={() => setPanel('devices')} />
          <ListRow
            icon={LockKeyhole}
            title="App lock"
            detail={lock ? `On · ${lock.pinLength}-digit PIN` : 'Off'}
            onClick={() => setPanel('lock')}
          />
        </Card>
      </section>
      <section>
        <SectionTitle>{book.name}</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          {/* Desktop has Members in the sidebar. */}
          <ListRow
            className="lg:hidden"
            to="/members"
            icon={Users}
            title="Members & sharing"
            detail={`${book.isPersonal ? 'Private book' : `${book.memberCount} member${book.memberCount === 1 ? '' : 's'}`} · invites, roles, export`}
          />
          <ListRow to="/recurring" icon={Repeat} title="Monthly entries" detail="Rent, salary, EMIs and other repeating entries" />
          <ListRow
            to="/categories"
            icon={Tags}
            title="Categories"
            detail={can('setup.manage') ? 'Rename, recolour, reorder or hide' : 'See the categories in this book'}
          />
          {can('txn.delete.own') && <ListRow to="/transactions/deleted" icon={Trash2} title="Recently deleted" detail="Restore deleted transactions" />}
        </Card>
      </section>
      <Button variant="danger" className="w-full" onClick={() => signOut()}>
        <LogOut className="size-4" /> Sign out
      </Button>
      <p className="text-center text-caption text-muted">Family Finance OS · v0.1</p>

      <Sheet open={panel === 'profile'} onClose={close} title="Profile">
        <ProfileForm onDone={close} />
      </Sheet>
      <Sheet open={panel === 'password'} onClose={close} title="Password">
        <PasswordForm />
      </Sheet>
      <Sheet open={panel === 'devices'} onClose={close} title="Signed-in devices">
        <Devices />
      </Sheet>
      <Sheet open={panel === 'lock'} onClose={close} title="App lock">
        <AppLockSettings />
      </Sheet>
    </div>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user!.name, email: user!.email ?? '' });
  const save = useMutation({
    mutationFn: () => api.patch<UserDTO>('/me', form),
    onSuccess: (updated) => {
      setUser(updated);
      onDone();
    },
  });
  const errors = fieldErrors(save.error);
  const dirty = form.name !== user!.name || form.email !== (user!.email ?? '');

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Field label="Email (optional)" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <ErrorBanner error={Object.keys(errors).length ? null : save.error} />
      <Button type="submit" variant="secondary" className="w-full" disabled={!dirty} loading={save.isPending}>
        Save profile
      </Button>
    </form>
  );
}

function PasswordForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const save = useMutation({
    mutationFn: () => api.post('/me/password', form),
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '' });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} error={errors.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      <Field label="New password" type="password" autoComplete="new-password" hint="Other devices will be signed out" value={form.newPassword} error={errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      <ErrorBanner error={Object.keys(errors).length ? null : save.error} />
      {save.isSuccess && <p className="text-label text-positive">Password changed.</p>}
      <Button type="submit" variant="secondary" className="w-full" disabled={!form.currentPassword || !form.newPassword} loading={save.isPending}>
        Change password
      </Button>
    </form>
  );
}

function Devices() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionDTO[]>('/me/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/me/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <>
      <ErrorBanner error={sessions.error ?? revoke.error} />
      <Card className="divide-y divide-line overflow-hidden">
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <Smartphone className="size-4.5 shrink-0 text-muted" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-label">
              <span className="block truncate font-medium">{s.deviceName}</span>
              <span className="text-muted">{s.current ? 'This device' : `Active ${relativeTime(s.lastUsedAt)}`}</span>
            </span>
            {!s.current && (
              <button
                onClick={() => revoke.mutate(s.id)}
                className="grid size-10 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                aria-label={`Sign out ${s.deviceName}`}
              >
                <X className="size-5" />
              </button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
