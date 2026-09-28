import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ROLE_LABELS, type AuthResponse, type InvitePreviewDTO } from '@ffos/shared';
import { AuthLayout, PhoneField } from '../components/auth-ui.tsx';
import { Button, ErrorBanner, Field, fieldErrors, FullScreenSpinner } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { LoginForm } from './AuthPages.tsx';

function rememberBook(bookId: string) {
  try {
    localStorage.setItem('ffos.book', bookId);
  } catch {
    // ignore
  }
}

export function InvitePage() {
  const { token = '' } = useParams();
  const { status } = useAuth();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitePreviewDTO>(`/invites/${token}`),
    retry: false,
  });

  if (preview.isLoading) return <FullScreenSpinner />;
  if (preview.error || !preview.data) {
    return (
      <AuthLayout title="Invite unavailable">
        <div className="text-center">
          <MailX className="mx-auto mb-3 size-8 text-muted" />
          <p className="mb-6 text-muted">
            {preview.error instanceof ApiError ? preview.error.message : 'This invite link is not valid.'} Ask the
            person who invited you for a new link.
          </p>
          <Link to="/" className="font-medium text-accent">
            Go to the app
          </Link>
        </div>
      </AuthLayout>
    );
  }

  const invite = preview.data;
  const subtitle = (
    <>
      <strong className="font-semibold text-ink">{invite.invitedByName}</strong> invited you to join as{' '}
      <strong className="font-semibold text-ink">{ROLE_LABELS[invite.role].name}</strong>:{' '}
      {ROLE_LABELS[invite.role].description.toLowerCase()}.
    </>
  );

  return (
    <AuthLayout title={`Join “${invite.bookName}”`} subtitle={subtitle}>
      {status === 'signedIn' ? <AcceptInvite token={token} /> : <JoinAsNewOrExisting token={token} invite={invite} />}
    </AuthLayout>
  );
}

function AcceptInvite({ token }: { token: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api.post<{ bookId: string }>(`/invites/${token}/accept`),
    onSuccess: async ({ bookId }) => {
      rememberBook(bookId);
      await queryClient.invalidateQueries({ queryKey: ['books'] });
      navigate('/', { replace: true });
    },
  });
  return (
    <div className="space-y-3">
      <ErrorBanner error={accept.error} />
      <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
        Join book
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => navigate('/', { replace: true })}>
        Not now
      </Button>
    </div>
  );
}

function JoinAsNewOrExisting({ token, invite }: { token: string; invite: InvitePreviewDTO }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '+91', email: '', password: '' });
  const register = useMutation({
    mutationFn: () => api.post<AuthResponse & { joinedBookId: string }>('/auth/register', { ...form, inviteToken: token }),
    onSuccess: (res) => {
      rememberBook(res.joinedBookId);
      navigate('/', { replace: true });
      signIn(res);
    },
  });
  const errors = fieldErrors(register.error);

  if (mode === 'login') {
    return (
      <>
        <p className="mb-4 text-center text-sm text-muted">Sign in, then accept the invite.</p>
        <LoginForm />
        <p className="mt-4 text-center text-sm">
          New to FFOS?{' '}
          <button className="font-medium text-accent" onClick={() => setMode('register')}>
            Create an account
          </button>
        </p>
      </>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        register.mutate();
      }}
    >
      <ErrorBanner error={Object.keys(errors).length ? null : register.error} />
      <Field label="Your name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <PhoneField
        value={form.phone}
        error={errors.phone}
        onChange={(phone) => setForm({ ...form, phone })}
        label={invite.phoneRestricted ? 'Phone number (the one you were invited with)' : 'Phone number'}
      />
      <Field label="Email (optional)" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Field label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      <Button type="submit" className="w-full" loading={register.isPending}>
        Create account & join
      </Button>
      <p className="text-center text-sm">
        Already have an account?{' '}
        <button type="button" className="font-medium text-accent" onClick={() => setMode('login')}>
          Sign in
        </button>
      </p>
    </form>
  );
}
