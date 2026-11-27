import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Check, Copy, KeyRound, Share2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import type { AdminUserDTO, ResetLinkDTO } from '@ffos/shared';
import { PageTitle } from '../components/AppShell.tsx';
import { useConfirm } from '../components/Confirm.tsx';
import { Avatar, Button, Card, ErrorBanner, PageSkeleton, SectionTitle, Sheet } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { relativeTime } from '../lib/format.ts';

/** The instance owner looks after everyone's accounts: reset links for people locked out, and turning sign-in off. */
export function AccountsPage() {
  const { user } = useAuth();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUserDTO[]>('/admin/users'), enabled: user!.isInstanceOwner });
  const [selected, setSelected] = useState<AdminUserDTO | null>(null);
  if (!user!.isInstanceOwner) return <Navigate to="/more" replace />;
  const list = users.data ?? [];

  return (
    <div className="space-y-5">
      <Link to="/more" className="-ml-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-label font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageTitle subtitle="Everyone who can sign in to this app. You see this because you set the app up.">Users</PageTitle>
      <ErrorBanner error={users.error} />
      {users.isLoading ? (
        <PageSkeleton />
      ) : (
        <section>
          <SectionTitle>
            {list.length} user{list.length === 1 ? '' : 's'}
          </SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {list.map((u) => (
              <button key={u.id} onClick={() => setSelected(u)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle/60">
                <Avatar name={u.name} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-body font-medium ${u.disabled ? 'text-muted line-through' : ''}`}>
                    {u.name}
                    {u.id === user!.id && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  <span className="block truncate text-caption text-muted tabular">
                    {u.phone} · {u.lastActiveAt ? `active ${relativeTime(u.lastActiveAt)}` : 'not signed in'}
                  </span>
                </span>
                {u.disabled && <span className="shrink-0 rounded-md bg-subtle px-2 py-0.5 text-caption text-muted">Off</span>}
              </button>
            ))}
          </Card>
        </section>
      )}
      <AccountSheet account={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AccountSheet({ account, onClose }: { account: AdminUserDTO | null; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [link, setLink] = useState<ResetLinkDTO | null>(null);
  const [copied, setCopied] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  if ((account?.id ?? null) !== forId) {
    setForId(account?.id ?? null);
    setLink(null);
    setCopied(false);
  }
  const makeLink = useMutation({
    mutationFn: () => api.post<ResetLinkDTO>(`/admin/users/${account!.id}/reset-link`),
    onSuccess: setLink,
  });
  const toggle = useMutation({
    mutationFn: () => api.post(`/admin/users/${account!.id}/${account!.disabled ? 'enable' : 'disable'}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
  });
  if (!account) return null;
  const url = link ? `${location.origin}${location.pathname}#/reset/${link.token}` : '';
  const message = `Open this link to set a new password for Family Finance OS. It works once, for 24 hours:\n${url}`;
  const isMe = account.id === user!.id;

  return (
    <Sheet open onClose={onClose} title={account.name}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-label">
          <dt className="text-muted">Phone</dt>
          <dd className="tabular">{account.phone}</dd>
          {account.email && (
            <>
              <dt className="text-muted">Email</dt>
              <dd className="truncate">{account.email}</dd>
            </>
          )}
          <dt className="text-muted">Joined</dt>
          <dd>{new Date(account.createdAt).toLocaleDateString()}</dd>
          <dt className="text-muted">Books</dt>
          <dd>{account.bookCount}</dd>
          <dt className="text-muted">Recovery codes left</dt>
          <dd>{account.recoveryCodesLeft}</dd>
        </dl>

        {!isMe && !account.disabled && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-label font-medium">Locked out?</p>
            <p className="text-caption text-muted">Make a one-time link that lets {account.name.split(' ')[0]} set a new password. It works for 24 hours and signs them out everywhere.</p>
            {link ? (
              <>
                <p className="rounded-lg bg-subtle px-3 py-2 font-mono text-caption break-all">{url}</p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(url).catch(() => undefined);
                      setCopied(true);
                    }}
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}
                  </Button>
                  {typeof navigator.share === 'function' && (
                    <Button className="flex-1" onClick={() => navigator.share({ title: 'Reset your password', text: message }).catch(() => undefined)}>
                      <Share2 className="size-4" /> Share
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <Button variant="secondary" className="w-full" loading={makeLink.isPending} onClick={() => makeLink.mutate()}>
                <KeyRound className="size-4" /> Make a password reset link
              </Button>
            )}
            <ErrorBanner error={makeLink.error} />
          </div>
        )}

        {!isMe && (
          <Button
            variant={account.disabled ? 'secondary' : 'danger'}
            className="w-full"
            loading={toggle.isPending}
            onClick={async () => {
              if (!account.disabled) {
                const ok = await confirm({
                  title: `Turn off ${account.name}'s account?`,
                  message: "They'll be signed out and can't sign in until you turn it back on. Their entries stay in every book.",
                  confirmLabel: 'Turn off',
                  danger: true,
                });
                if (!ok) return;
              }
              toggle.mutate();
            }}
          >
            {account.disabled ? <ShieldCheck className="size-4" /> : <Ban className="size-4" />}
            {account.disabled ? 'Turn sign-in back on' : 'Turn off sign-in'}
          </Button>
        )}
        <ErrorBanner error={toggle.error} />
      </div>
    </Sheet>
  );
}
