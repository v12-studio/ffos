import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CircleHelp, Copy, Download, FileDown, FileUp, KeyRound, LockKeyhole, LogOut, Palette, Repeat, Settings2, Smartphone, Tags, Trash2, UserCog, UserX, Users, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PushStatusDTO, SessionDTO, UserDTO } from '@ffos/shared';
import { AppLockSettings, useAppLock } from '../components/AppLock.tsx';
import { PageTitle } from '../components/AppShell.tsx';
import { BookSettings } from '../components/BookSettings.tsx';
import { ExportSheet } from '../components/ExportSheet.tsx';
import { Avatar, Button, Card, ErrorBanner, Field, fieldErrors, ListRow, SectionTitle, Segmented, Sheet } from '../components/ui.tsx';
import { api, download } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useCurrentBook } from '../lib/book.tsx';
import { relativeTime, todayISO } from '../lib/format.ts';
import { currentSubscription, pushSupport, subscribe } from '../lib/push.ts';
import { ACCENTS, OVERVIEW_CARD_LABELS, OVERVIEW_CARDS, useTheme, type TextSize, type ThemeMode, type ThemePrefs } from '../lib/theme.ts';
import { DragHandle, moveItem, SortableList } from '../components/Sortable.tsx';

type Panel = 'profile' | 'password' | 'devices' | 'lock' | 'appearance' | 'book' | 'export' | 'delete' | 'notifications' | null;

export function MorePage() {
  const { user, signOut } = useAuth();
  const { book, can } = useCurrentBook();
  const { config: lock } = useAppLock();
  // Other screens can open a panel directly: /more?open=book
  const [params, setParams] = useSearchParams();
  const [panel, setPanel] = useState<Panel>(() => (params.get('open') as Panel) ?? null);
  useEffect(() => {
    if (params.get('open')) setParams({}, { replace: true });
  }, []);
  const close = () => setPanel(null);
  const [theme, setTheme] = useTheme();
  const canBookSettings = can('book.settings') || book.role !== 'owner' || (can('book.delete') && !book.isPersonal);
  return (
    <div className="space-y-6">
      <PageTitle tab>Settings</PageTitle>
      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          <ListRow
            leading={<Avatar name={user!.name} />}
            title={user!.name}
            detail={`${user!.phone}${user!.email ? ` · ${user!.email}` : ''}`}
            onClick={() => setPanel('profile')}
          />
          <ListRow
            icon={KeyRound}
            title="Password & recovery codes"
            detail={user!.recoveryCodesLeft <= 2 ? `Only ${user!.recoveryCodesLeft} recovery code${user!.recoveryCodesLeft === 1 ? '' : 's'} left` : 'Change password, make new recovery codes'}
            onClick={() => setPanel('password')}
          />
          <ListRow icon={Smartphone} title="Signed-in devices" detail="See and sign out other devices" onClick={() => setPanel('devices')} />
          {user!.isInstanceOwner && <ListRow to="/users" icon={UserCog} title="Users" detail="Everyone who can sign in: reset links, turn sign-in off" />}
        </Card>
      </section>
      <section>
        <SectionTitle>This device</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          <ListRow
            icon={Palette}
            title="Appearance"
            detail={`${MODE_LABEL[theme.mode]} · ${ACCENTS.find((a) => a.value === theme.accent)!.label} · ${TEXT_LABEL[theme.text]} text`}
            onClick={() => setPanel('appearance')}
          />
          <ListRow icon={Bell} title="Notifications" detail="Bills due and budgets running low" onClick={() => setPanel('notifications')} />
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
          {canBookSettings && (
            <ListRow icon={Settings2} title="Book settings" detail={`Name, currency, colour · ${book.currency}`} onClick={() => setPanel('book')} />
          )}
          {can('book.export') && <ListRow icon={Download} title="Export" detail="Budget, transactions or everything · CSV, Excel, backup" onClick={() => setPanel('export')} />}
          <ListRow to="/accounts" icon={Wallet} title="Accounts & balances" detail="Cash, bank, cards and wallets, and money moved between them" />
          {can('book.import') && <ListRow to="/import" icon={FileUp} title="Import transactions" detail="From a bank statement or spreadsheet (CSV)" />}
          <ListRow to="/recurring" icon={Repeat} title="Repeating entries" detail="Rent, salary, EMIs, yearly insurance and fees" />
          <ListRow
            to="/categories"
            icon={Tags}
            title="Categories"
            detail={can('setup.manage') ? 'Rename, recolour, reorder or hide' : 'See the categories in this book'}
          />
          {can('txn.delete.own') && <ListRow to="/transactions/deleted" icon={Trash2} title="Recently deleted" detail="Restore deleted transactions" />}
        </Card>
      </section>
      <section>
        <SectionTitle>Help</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow to="/help" icon={CircleHelp} title="Help & guide" detail="How budgets, sharing, imports and your data work" />
        </Card>
      </section>
      <Button variant="danger" className="w-full" onClick={() => signOut()}>
        <LogOut className="size-4" /> Sign out
      </Button>
      <section>
        <SectionTitle>Your data</SectionTitle>
        <Card className="divide-y divide-line overflow-hidden">
          <DownloadMyData />
          <ListRow icon={UserX} title="Delete my account" detail="Remove your account and the books only you use" onClick={() => setPanel('delete')} />
        </Card>
      </section>
      <p className="text-center text-caption text-muted">Family Finance OS · v0.1</p>

      <Sheet open={panel === 'profile'} onClose={close} title="Profile">
        <ProfileForm onDone={close} />
      </Sheet>
      <Sheet open={panel === 'password'} onClose={close} title="Password & recovery codes">
        <PasswordForm />
        <RecoveryCodes />
      </Sheet>
      <Sheet open={panel === 'delete'} onClose={close} title="Delete my account">
        <DeleteAccount />
      </Sheet>
      <Sheet open={panel === 'devices'} onClose={close} title="Signed-in devices">
        <Devices />
      </Sheet>
      <Sheet open={panel === 'lock'} onClose={close} title="App lock">
        <AppLockSettings />
      </Sheet>
      <Sheet open={panel === 'notifications'} onClose={close} title="Notifications">
        <NotificationSettings />
      </Sheet>
      <Sheet open={panel === 'appearance'} onClose={close} title="Appearance">
        <AppearanceSettings theme={theme} setTheme={setTheme} />
      </Sheet>
      <Sheet open={panel === 'book'} onClose={close} title="Book settings">
        <BookSettings onDone={close} />
      </Sheet>
      <ExportSheet open={panel === 'export'} onClose={close} preset={{ what: 'everything', period: 'all' }} />
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

const MODE_LABEL: Record<ThemeMode, string> = { system: 'Match phone', light: 'Light', dark: 'Dark' };
const TEXT_LABEL: Record<TextSize, string> = { normal: 'Normal', large: 'Large', larger: 'Larger' };

/** Light or dark, accent colour and text size, for this device only. */
function AppearanceSettings({ theme, setTheme }: { theme: ThemePrefs; setTheme: (patch: Partial<ThemePrefs>) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1.5 text-label font-medium">Theme</p>
        <Segmented
          value={theme.mode}
          onChange={(mode) => setTheme({ mode })}
          options={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: MODE_LABEL[value] }))}
        />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-label font-medium">Accent colour</legend>
        <div className="grid grid-cols-6 gap-2">
          {ACCENTS.map((a) => {
            const on = a.value === theme.accent;
            return (
              <button
                key={a.value}
                type="button"
                onClick={() => setTheme({ accent: a.value })}
                aria-label={a.label}
                aria-pressed={on}
                className={`grid aspect-square place-items-center rounded-full ring-offset-2 ring-offset-surface ${on ? 'ring-2 ring-ink' : ''}`}
                style={{ backgroundColor: a.swatch }}
              >
                {on && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-caption text-muted">Used for buttons, links and highlights.</p>
      </fieldset>
      <div>
        <p className="mb-1.5 text-label font-medium">Text size</p>
        <Segmented
          value={theme.text}
          onChange={(text) => setTheme({ text })}
          options={(['normal', 'large', 'larger'] as const).map((value) => ({ value, label: TEXT_LABEL[value] }))}
        />
        <p className="mt-1.5 text-caption text-muted">Makes everything in the app bigger, not just the text.</p>
      </div>
      <div>
        <p className="mb-1.5 text-label font-medium">Middle tab</p>
        <Segmented
          value={theme.tab}
          onChange={(tab) => setTheme({ tab })}
          options={[
            { value: 'budget', label: 'Budget' },
            { value: 'reports', label: 'Reports' },
          ]}
        />
        <p className="mt-1.5 text-caption text-muted">The tab between Transactions and Settings on phones. The other stays a tap away from the Overview.</p>
      </div>
      <div>
        <p className="mb-1.5 text-label font-medium">Overview cards</p>
        <Card className="overflow-hidden">
          <SortableList
            className="divide-y divide-line"
            items={[...theme.overview, ...OVERVIEW_CARDS.filter((c) => !theme.overview.includes(c))]}
            keyOf={(c) => c}
            onMove={(from, to) => {
              const all = [...theme.overview, ...OVERVIEW_CARDS.filter((c) => !theme.overview.includes(c))];
              const moved = moveItem(all, from, to);
              setTheme({ overview: moved.filter((c) => theme.overview.includes(c)) });
            }}
            renderItem={(card, handle) => {
              const on = theme.overview.includes(card);
              return (
                <div className="flex min-h-12 items-center gap-2 pr-3 pl-3">
                  <DragHandle handle={handle} label={OVERVIEW_CARD_LABELS[card]} />
                  <span className={`min-w-0 flex-1 truncate text-label ${on ? '' : 'text-muted'}`}>{OVERVIEW_CARD_LABELS[card]}</span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setTheme({
                        overview: e.target.checked
                          ? [...theme.overview, card].sort((a, b) => OVERVIEW_CARDS.indexOf(a) - OVERVIEW_CARDS.indexOf(b))
                          : theme.overview.filter((c) => c !== card),
                      })
                    }
                    aria-label={`Show ${OVERVIEW_CARD_LABELS[card]}`}
                    className="size-5 shrink-0 accent-[var(--app-primary)]"
                  />
                </div>
              );
            }}
          />
        </Card>
        <p className="mt-1.5 text-caption text-muted">Hold ⠿ to reorder; untick to hide. The budget or month summary always comes first.</p>
      </div>
      <p className="text-caption text-muted">These settings apply to this device only.</p>
    </div>
  );
}

/** Fresh recovery codes replace the old set; shown once. */
function RecoveryCodes() {
  const { user, setUser } = useAuth();
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const make = useMutation({
    mutationFn: () => api.post<{ codes: string[] }>('/me/recovery-codes', { password }),
    onSuccess: (res) => {
      setPassword('');
      setUser({ ...user!, recoveryCodesLeft: res.codes.length });
    },
  });
  const errors = fieldErrors(make.error);
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-5">
      <div>
        <p className="text-body font-medium">Recovery codes</p>
        <p className="text-label text-muted">
          {user!.recoveryCodesLeft} of 8 left. Each one resets your password once if you forget it. Making new codes cancels the old ones.
        </p>
      </div>
      {make.data ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line bg-subtle/60 p-4 font-mono text-body">
            {make.data.codes.map((c) => (
              <span key={c} className="text-center tracking-wider">
                {c}
              </span>
            ))}
          </div>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await navigator.clipboard?.writeText(make.data.codes.join('\n')).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy codes'}
          </Button>
          <p className="text-caption text-muted">Save them somewhere safe, away from this phone. They won't be shown again.</p>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            make.mutate();
          }}
        >
          <Field label="Your password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorBanner error={Object.keys(errors).length ? null : make.error} />
          <Button type="submit" variant="secondary" className="w-full" disabled={!password} loading={make.isPending}>
            Make new recovery codes
          </Button>
        </form>
      )}
    </div>
  );
}

function DownloadMyData() {
  const fetchData = useMutation({ mutationFn: () => download('/me/export', `ffos-my-data-${todayISO()}.json`) });
  return (
    <>
      <ListRow
        icon={FileDown}
        title={fetchData.isPending ? 'Preparing…' : 'Download my data'}
        detail="Your profile, devices, books and every entry you added (JSON)"
        onClick={() => !fetchData.isPending && fetchData.mutate()}
      />
      {fetchData.error ? (
        <div className="px-4 py-2">
          <ErrorBanner error={fetchData.error} />
        </div>
      ) : null}
    </>
  );
}

/** Deleting the account: books only this person uses go with it; shared books must be handed over first. */
function DeleteAccount() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [sure, setSure] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.del('/me', { password }),
    onSuccess: async () => {
      queryClient.clear();
      await signOut().catch(() => undefined);
    },
  });
  const errors = fieldErrors(remove.error);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        remove.mutate();
      }}
    >
      <ul className="list-disc space-y-1.5 pl-5 text-label text-muted">
        <li>Your account, devices and recovery codes are removed.</li>
        <li>Books only you use (like Personal) are deleted with everything in them.</li>
        <li>In books shared with others, entries you added stay, shown as added by a former member.</li>
        <li>If you own a shared book, make someone else its owner first (Members → tap a member).</li>
      </ul>
      <p className="text-label">This can't be undone. Download your data first if you want a copy.</p>
      <Field label="Your password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
      <label className="flex items-center gap-3 text-label">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="size-5 accent-[var(--app-primary)]" />
        I understand my account will be deleted for good
      </label>
      <ErrorBanner error={Object.keys(errors).length ? null : remove.error} />
      <Button type="submit" variant="danger" className="w-full" disabled={!password || !sure} loading={remove.isPending}>
        <Trash2 className="size-4" /> Delete my account
      </Button>
    </form>
  );
}

/** Reminders on this device: bills due today or tomorrow, and spending categories nearly used up or over. */
function NotificationSettings() {
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const support = pushSupport();
  const status = useQuery({ queryKey: ['push'], queryFn: () => api.get<PushStatusDTO>('/me/push') });
  const here = useQuery({ queryKey: ['push', 'here'], queryFn: currentSubscription, enabled: support === 'supported' });
  const onHere = Boolean(here.data && status.data?.endpoints.includes(here.data.endpoint));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['push'] });
  };
  const turnOn = useMutation({
    mutationFn: async () => {
      const sub = await subscribe(status.data!.publicKey!);
      await api.post('/me/push', sub);
    },
    onSuccess: refresh,
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      const sub = await currentSubscription();
      if (sub) {
        await api.del('/me/push', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    },
    onSuccess: refresh,
  });
  const test = useMutation({ mutationFn: () => api.post<{ sent: number; devices: number }>('/me/push/test') });
  const prefs = useMutation({
    mutationFn: (notify: UserDTO['notify']) => api.patch<UserDTO>('/me', { notify }),
    onSuccess: setUser,
  });
  const notify = user!.notify ?? { bills: true, budget: true };

  if (support !== 'supported') {
    return (
      <p className="text-label text-muted">
        {support === 'needs-install'
          ? 'On iPhone, notifications work once the app is on your home screen: Share → Add to Home Screen, then open it from there and come back here.'
          : "This browser can't show notifications. Try Chrome on Android, or the app on your home screen."}
      </p>
    );
  }
  if (status.data && !status.data.publicKey) {
    return <p className="text-label text-muted">Notifications aren't switched on for this app yet. Whoever runs it needs to add the notification keys on the server (see the README).</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-label text-muted">Once a day (9 am) at most, one note per book. Nothing is sent about entries themselves.</p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
        <span className="text-label">
          <span className="block font-medium">On this device</span>
          <span className="text-muted">{onHere ? 'On' : 'Off'}</span>
        </span>
        {onHere ? (
          <Button variant="secondary" className="min-h-9! px-3 text-label" loading={turnOff.isPending} onClick={() => turnOff.mutate()}>
            Turn off
          </Button>
        ) : (
          <Button className="min-h-9! px-3 text-label" disabled={!status.data} loading={turnOn.isPending} onClick={() => turnOn.mutate()}>
            Turn on
          </Button>
        )}
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-label font-medium">Tell me about</legend>
        {(
          [
            ['bills', 'Bills due today or tomorrow', 'From your repeating entries, until they’re added'],
            ['budget', 'Budgets running low or over', 'Spending categories past your warn level'],
          ] as const
        ).map(([key, title, detail]) => (
          <label key={key} className="flex min-h-12 items-center justify-between gap-3">
            <span className="text-label">
              <span className="block">{title}</span>
              <span className="block text-caption text-muted">{detail}</span>
            </span>
            <input
              type="checkbox"
              checked={notify[key]}
              onChange={(e) => prefs.mutate({ ...notify, [key]: e.target.checked })}
              className="size-5 shrink-0 accent-[var(--app-primary)]"
            />
          </label>
        ))}
      </fieldset>
      {(status.data?.endpoints.length ?? 0) > 0 && (
        <Button variant="secondary" className="w-full" loading={test.isPending} onClick={() => test.mutate()}>
          Send a test notification
        </Button>
      )}
      {test.data && <p className="text-caption text-muted">Sent to {test.data.sent} of {test.data.devices} device{test.data.devices === 1 ? '' : 's'}.</p>}
      <ErrorBanner error={turnOn.error ?? turnOff.error ?? test.error ?? prefs.error} />
    </div>
  );
}
