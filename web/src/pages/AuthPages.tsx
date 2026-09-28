import { useMutation } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AuthResponse } from '@ffos/shared';
import { AuthLayout, PhoneField } from '../components/auth-ui.tsx';
import { Button, ErrorBanner, Field, fieldErrors } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export function SetupPage() {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '+91', email: '', password: '' });
  const mutation = useMutation({
    mutationFn: () => api.post<AuthResponse>('/auth/setup', form),
    onSuccess: signIn,
  });
  const errors = fieldErrors(mutation.error);

  return (
    <AuthLayout title="Welcome to FFOS" subtitle="Create the owner account for this app. This screen only appears once.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <ErrorBanner error={Object.keys(errors).length ? null : mutation.error} />
        <Field label="Your name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <PhoneField value={form.phone} error={errors.phone} onChange={(phone) => setForm({ ...form, phone })} />
        <Field label="Email (optional)" type="email" autoComplete="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function LoginForm({ onSuccess }: { onSuccess?: (res: AuthResponse) => void }) {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ phone: '+91', password: '' });
  const mutation = useMutation({
    mutationFn: () => api.post<AuthResponse>('/auth/login', form),
    onSuccess: (res) => {
      onSuccess?.(res);
      signIn(res);
    },
  });
  const errors = fieldErrors(mutation.error);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <ErrorBanner error={Object.keys(errors).length ? null : mutation.error} />
      <PhoneField value={form.phone} error={errors.phone} onChange={(phone) => setForm({ ...form, phone })} />
      <Field label="Password" type="password" autoComplete="current-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      <Button type="submit" className="w-full" loading={mutation.isPending}>
        Sign in
      </Button>
    </form>
  );
}

export function LoginPage() {
  return (
    <AuthLayout title="Sign in" subtitle="Family Finance OS">
      <LoginForm />
      <p className="mt-4 text-center text-sm">
        <Link to="/recover" className="font-medium text-accent">
          Forgot password?
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RecoverPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone: '+91', code: '', newPassword: '' });
  const mutation = useMutation({
    mutationFn: () => api.post<{ remainingCodes: number }>('/auth/recover', form),
  });
  const errors = fieldErrors(mutation.error);

  if (mutation.isSuccess) {
    return (
      <AuthLayout title="Password reset" subtitle="You've been signed out on all devices.">
        <p className="mb-4 text-center text-sm text-muted">
          You have {mutation.data.remainingCodes} recovery code{mutation.data.remainingCodes === 1 ? '' : 's'} left.
        </p>
        <Button className="w-full" onClick={() => navigate('/login')}>
          Sign in
        </Button>
      </AuthLayout>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <AuthLayout title="Reset password" subtitle="Use one of the recovery codes you saved when you signed up.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <ErrorBanner error={Object.keys(errors).length ? null : mutation.error} />
        <PhoneField value={form.phone} error={errors.phone} onChange={(phone) => setForm({ ...form, phone })} />
        <Field label="Recovery code" placeholder="abcd-efgh" autoCapitalize="none" autoComplete="one-time-code" value={form.code} error={errors.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        <Field label="New password" type="password" autoComplete="new-password" value={form.newPassword} error={errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
        <Button type="submit" className="w-full" loading={mutation.isPending}>
          Reset password
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="font-medium text-accent">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RecoveryCodesScreen({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  return (
    <AuthLayout title="Save your recovery codes" subtitle="If you forget your password, each code can reset it once. They won't be shown again.">
      <div className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line bg-subtle/60 p-5 font-mono text-[15px]">
        {codes.map((c) => (
          <span key={c} className="text-center tracking-wider">
            {c}
          </span>
        ))}
      </div>
      <div className="space-y-3">
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            await navigator.clipboard?.writeText(text).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy codes'}
        </Button>
        <label className="flex items-center gap-3 rounded-xl px-1 py-2 text-sm">
          <input type="checkbox" className="size-4.5 accent-[var(--app-primary)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I've saved these codes somewhere safe
        </label>
        <Button className="w-full" disabled={!saved} onClick={onDone}>
          <KeyRound className="size-4" />
          Continue
        </Button>
      </div>
    </AuthLayout>
  );
}
