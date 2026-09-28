import { Delete, Fingerprint, Lock, LockKeyhole } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import {
  biometricLabel,
  biometricsAvailable,
  blockAfterFailure,
  createLock,
  LOCK_TIMEOUTS,
  MAX_ATTEMPTS,
  pinMatches,
  readLock,
  registerBiometrics,
  verifyBiometrics,
  writeLock,
  type LockConfig,
} from '../lib/applock.ts';
import { Logo } from './auth-ui.tsx';
import { Button, Card, ErrorBanner, Field, SectionTitle, Sheet } from './ui.tsx';

interface AppLockState {
  config: LockConfig | null;
  setConfig: (config: LockConfig | null) => void;
  lockNow: () => void;
}

const AppLockContext = createContext<AppLockState | null>(null);

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside AppLockProvider');
  return ctx;
}

/**
 * Locks when the app opens and after it has been in the background longer than the chosen delay.
 * While locked, nothing of the app is rendered, so no data shows behind the lock screen.
 */
export function AppLockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user!.id;
  const [config, setConfigState] = useState<LockConfig | null>(() => readLock(userId));
  const [locked, setLocked] = useState(() => readLock(userId) !== null);
  const hiddenAt = useRef<number | null>(null);

  const setConfig = useCallback(
    (next: LockConfig | null) => {
      writeLock(userId, next);
      setConfigState(next);
    },
    [userId],
  );

  useEffect(() => {
    if (!config) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null) {
        if (Date.now() - hiddenAt.current >= config.timeoutMin * 60_000) setLocked(true);
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [config]);

  if (locked && config) {
    return <LockScreen config={config} onConfigChange={setConfig} onUnlock={() => setLocked(false)} />;
  }
  return (
    <AppLockContext.Provider value={{ config, setConfig, lockNow: () => config && setLocked(true) }}>
      {children}
    </AppLockContext.Provider>
  );
}

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'back'] as const;

function LockScreen({
  config,
  onConfigChange,
  onUnlock,
}: {
  config: LockConfig;
  onConfigChange: (c: LockConfig) => void;
  onUnlock: () => void;
}) {
  const { user, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [canUseBio, setCanUseBio] = useState(false);
  const blockedFor = config.blockedUntil ? Math.max(0, Math.ceil((config.blockedUntil - now) / 1000)) : 0;

  useEffect(() => {
    if (!blockedFor) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [blockedFor]);

  const unlock = useCallback(() => {
    onConfigChange({ ...config, failedAttempts: 0, blockedUntil: undefined });
    onUnlock();
  }, [config, onConfigChange, onUnlock]);

  const tryBiometrics = useCallback(async () => {
    if (!config.credentialId) return;
    setError('');
    try {
      if (await verifyBiometrics(config.credentialId)) unlock();
    } catch {
      // Cancelled or not recognised; the PIN still works.
    }
  }, [config.credentialId, unlock]);

  useEffect(() => {
    if (!config.credentialId) return;
    biometricsAvailable().then((ok) => {
      setCanUseBio(ok);
      // iOS only allows the prompt after a tap; elsewhere offer it straight away.
      if (ok && !/iPhone|iPad/.test(navigator.userAgent)) void tryBiometrics();
    });
  }, []); // only when the lock screen first appears

  const check = useCallback(
    async (candidate: string) => {
      setChecking(true);
      const ok = await pinMatches(config, candidate);
      setChecking(false);
      if (ok) return unlock();

      const failedAttempts = config.failedAttempts + 1;
      if (failedAttempts >= MAX_ATTEMPTS) {
        await signOut();
        return;
      }
      onConfigChange({ ...config, failedAttempts, blockedUntil: blockAfterFailure(failedAttempts) });
      setNow(Date.now());
      setPin('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      const left = MAX_ATTEMPTS - failedAttempts;
      setError(left <= 5 ? `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left before you're signed out.` : 'Wrong PIN.');
    },
    [config, onConfigChange, signOut, unlock],
  );

  const press = useCallback(
    (key: string) => {
      if (checking || blockedFor) return;
      if (key === 'back') return setPin((p) => p.slice(0, -1));
      if (key === 'bio') return void tryBiometrics();
      if (pin.length >= config.pinLength) return;
      const next = pin + key;
      setError('');
      setPin(next);
      if (next.length === config.pinLength) void check(next);
    },
    [blockedFor, check, checking, config.pinLength, pin, tryBiometrics],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-between px-6 pt-safe pb-safe">
      <div className="flex flex-col items-center pt-16 text-center">
        <Logo className="mb-5 size-10" />
        <h1 className="text-xl font-semibold tracking-tight">Welcome back, {user!.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-muted">{blockedFor ? `Too many attempts. Try again in ${blockedFor}s.` : 'Enter your PIN to unlock'}</p>

        <div className={`mt-8 flex gap-3.5 ${shake ? 'animate-[shake_0.4s]' : ''}`} aria-label={`${pin.length} of ${config.pinLength} digits entered`}>
          {Array.from({ length: config.pinLength }, (_, i) => (
            <span key={i} className={`size-3.5 rounded-full border-2 transition-colors ${i < pin.length ? 'border-ink bg-ink' : 'border-line'}`} />
          ))}
        </div>
        <p role="alert" className="mt-4 min-h-10 max-w-64 text-sm text-negative">
          {error}
        </p>
      </div>

      <div className="w-full max-w-72">
        <div className="grid grid-cols-3 gap-3">
          {PAD.map((k) => {
            if (k === 'bio') {
              return canUseBio ? (
                <button key={k} onClick={() => press(k)} className="grid aspect-square place-items-center rounded-full text-ink hover:bg-subtle" aria-label={`Unlock with ${biometricLabel()}`}>
                  <Fingerprint className="size-7" strokeWidth={1.5} />
                </button>
              ) : (
                <span key={k} />
              );
            }
            return (
              <button
                key={k}
                onClick={() => press(k)}
                disabled={Boolean(blockedFor)}
                className="grid aspect-square place-items-center rounded-full text-2xl font-medium tabular hover:bg-subtle active:bg-line disabled:opacity-40"
                aria-label={k === 'back' ? 'Delete digit' : k}
              >
                {k === 'back' ? <Delete className="size-6" strokeWidth={1.5} /> : k}
              </button>
            );
          })}
        </div>
        <button onClick={() => signOut()} className="mt-6 mb-6 w-full text-center text-sm font-medium text-accent">
          Forgot PIN? Sign out
        </button>
      </div>
    </div>
  );
}

// ── settings ──

type SheetMode = 'create' | 'change' | 'disable' | null;

export function AppLockSettings() {
  const { user } = useAuth();
  const { config, setConfig, lockNow } = useAppLock();
  const [mode, setMode] = useState<SheetMode>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioError, setBioError] = useState<unknown>(null);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    void biometricsAvailable().then(setBioAvailable);
  }, []);

  const toggleBiometrics = async () => {
    if (!config) return;
    setBioError(null);
    if (config.credentialId) return setConfig({ ...config, credentialId: undefined });
    setBioBusy(true);
    try {
      setConfig({ ...config, credentialId: await registerBiometrics(user!) });
    } catch (err) {
      setBioError(err instanceof DOMException && err.name === 'NotAllowedError' ? new Error('Biometric setup was cancelled.') : err);
    } finally {
      setBioBusy(false);
    }
  };

  return (
    <section>
      <SectionTitle>App lock</SectionTitle>
      <Card className="divide-y divide-line">
        {!config ? (
          <div className="flex items-start gap-3 p-4">
            <LockKeyhole className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">Protect this device</p>
              <p className="mt-0.5 text-sm text-muted">
                Ask for a PIN{bioAvailable ? ` or ${biometricLabel()}` : ''} when FFOS opens. Set separately on each device.
              </p>
              <Button className="mt-3" onClick={() => setMode('create')}>
                <Lock className="size-4" /> Set up app lock
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Row label="PIN" hint={`${config.pinLength} digits · on this device only`}>
              <Button variant="secondary" className="min-h-9! px-3 text-sm" onClick={() => setMode('change')}>
                Change
              </Button>
            </Row>
            {bioAvailable && (
              <Row label={`Unlock with ${biometricLabel()}`} hint={bioError ? undefined : 'PIN still works as a backup'}>
                <Switch checked={Boolean(config.credentialId)} disabled={bioBusy} onChange={toggleBiometrics} label={`Unlock with ${biometricLabel()}`} />
              </Row>
            )}
            {bioError !== null && (
              <div className="px-4 pb-3">
                <ErrorBanner error={bioError} />
              </div>
            )}
            <Row label="Lock when away">
              <select
                value={config.timeoutMin}
                onChange={(e) => setConfig({ ...config, timeoutMin: Number(e.target.value) })}
                className="min-h-9 rounded-lg border border-line bg-surface px-2 text-sm"
                aria-label="Lock when away"
              >
                {LOCK_TIMEOUTS.map((t) => (
                  <option key={t.minutes} value={t.minutes}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Row>
            <div className="flex gap-2 p-4">
              <Button variant="secondary" className="flex-1" onClick={lockNow}>
                <Lock className="size-4" /> Lock now
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => setMode('disable')}>
                Turn off
              </Button>
            </div>
          </>
        )}
      </Card>
      <PinSheet mode={mode} onClose={() => setMode(null)} />
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-[13px] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-surface shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function PinSheet({ mode, onClose }: { mode: SheetMode; onClose: () => void }) {
  const { config, setConfig } = useAppLock();
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCurrent('');
    setPin('');
    setConfirmPin('');
    setErrors({});
  }, [mode]);

  if (!mode) return null;
  const needsCurrent = mode !== 'create';
  const needsNew = mode !== 'disable';
  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (needsNew && !/^\d{4,6}$/.test(pin)) next.pin = 'Use 4 to 6 digits';
    if (needsNew && pin !== confirmPin) next.confirmPin = "PINs don't match";
    if (Object.keys(next).length) return setErrors(next);

    setBusy(true);
    try {
      if (needsCurrent && config && !(await pinMatches(config, current))) {
        return setErrors({ current: 'Current PIN is incorrect' });
      }
      if (mode === 'disable') setConfig(null);
      else {
        const fresh = await createLock(pin, config?.timeoutMin ?? 1);
        // Changing the PIN keeps biometrics and the timeout.
        setConfig(config ? { ...fresh, credentialId: config.credentialId, timeoutMin: config.timeoutMin } : fresh);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'create' ? 'Set up app lock' : mode === 'change' ? 'Change PIN' : 'Turn off app lock';
  const pinProps = { type: 'password', inputMode: 'numeric' as const, autoComplete: 'off', maxLength: 6 };

  return (
    <Sheet open onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === 'create' && <p className="text-sm text-muted">Choose a 4–6 digit PIN. It stays on this device and is never sent to the server.</p>}
        {needsCurrent && (
          <Field label="Current PIN" {...pinProps} value={current} error={errors.current} onChange={(e) => setCurrent(digitsOnly(e.target.value))} autoFocus />
        )}
        {needsNew && (
          <>
            <Field label="New PIN" {...pinProps} value={pin} error={errors.pin} onChange={(e) => setPin(digitsOnly(e.target.value))} autoFocus={!needsCurrent} />
            <Field label="Confirm PIN" {...pinProps} value={confirmPin} error={errors.confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} />
          </>
        )}
        <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} className="w-full" loading={busy}>
          {mode === 'create' ? 'Turn on app lock' : mode === 'change' ? 'Save new PIN' : 'Turn off app lock'}
        </Button>
      </form>
    </Sheet>
  );
}
