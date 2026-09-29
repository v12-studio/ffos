import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Repeat, Smartphone, Tags, Users, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { SessionDTO, UserDTO } from '@ffos/shared';
import { AppLockSettings } from '../components/AppLock.tsx';
import { PageTitle } from '../components/AppShell.tsx';
import { Avatar, Button, Card, ErrorBanner, Field, fieldErrors, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { relativeTime } from '../lib/format.ts';

export function MorePage() {
  const { user, signOut } = useAuth();
  const { book, can } = useCurrentBook();
  return (
    <div className="space-y-6">
      <PageTitle>Settings</PageTitle>
      <Card className="flex items-center gap-3 p-4">
        <Avatar name={user!.name} className="size-11 text-sm" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{user!.name}</p>
          <p className="truncate text-sm text-muted">
            {user!.phone}
            {user!.email ? ` · ${user!.email}` : ''}
          </p>
        </div>
      </Card>
      {/* On phones Members isn't in the tab bar; desktop has it in the sidebar. */}
      <Link to="/members" className="block lg:hidden">
        <Card className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-subtle/60">
          <Users className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Members & sharing</span>
            <span className="block truncate text-[13px] text-muted">
              {book.isPersonal ? 'Private book' : `${book.memberCount} member${book.memberCount === 1 ? '' : 's'}`} · invites,
              roles, export
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" />
        </Card>
      </Link>
      <section>
        <SectionTitle>{book.name}</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          <NavRow to="/recurring" icon={Repeat} title="Monthly entries" detail="Rent, salary, EMIs and other repeating entries" />
          <NavRow
            to="/categories"
            icon={Tags}
            title="Categories"
            detail={can('setup.manage') ? 'Rename, recolour, reorder or hide' : 'See the categories in this book'}
          />
        </Card>
      </section>
      <AppLockSettings />
      <ProfileForm />
      <PasswordForm />
      <Devices />
      <Button variant="danger" className="w-full" onClick={() => signOut()}>
        <LogOut className="size-4" /> Sign out
      </Button>
      <p className="text-center text-xs text-muted">Family Finance OS · v0.1</p>
    </div>
  );
}

function NavRow({ to, icon: Icon, title, detail }: { to: string; icon: LucideIcon; title: string; detail: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-subtle/60">
      <Icon className="size-5 shrink-0 text-muted" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block truncate text-[13px] text-muted">{detail}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

function ProfileForm() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: user!.name, email: user!.email ?? '' });
  const save = useMutation({ mutationFn: () => api.patch<UserDTO>('/me', form), onSuccess: setUser });
  const errors = fieldErrors(save.error);
  const dirty = form.name !== user!.name || form.email !== (user!.email ?? '');

  return (
    <section>
      <SectionTitle>Profile</SectionTitle>
      <Card className="p-4">
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
      </Card>
    </section>
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
    <section>
      <SectionTitle>Password</SectionTitle>
      <Card className="p-4">
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
          {save.isSuccess && <p className="text-sm text-positive">Password changed.</p>}
          <Button type="submit" variant="secondary" className="w-full" disabled={!form.currentPassword || !form.newPassword} loading={save.isPending}>
            Change password
          </Button>
        </form>
      </Card>
    </section>
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
    <section>
      <SectionTitle>Signed-in devices</SectionTitle>
      <ErrorBanner error={sessions.error ?? revoke.error} />
      <Card className="divide-y divide-line overflow-hidden">
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <Smartphone className="size-4.5 shrink-0 text-muted" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-sm">
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
    </section>
  );
}
