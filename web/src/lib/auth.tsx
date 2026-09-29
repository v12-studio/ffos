import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, UserDTO } from '@ffos/shared';
import { api, hasStoredSession, onSessionEnded, refreshSession, setTokens, storedRefreshToken } from './api.ts';
import { clearAllLocks } from './applock.ts';
import { clearSnapshots, loadSnapshot, saveSnapshot } from './snapshot.ts';

type Status = 'loading' | 'setup' | 'signedOut' | 'signedIn' | 'offline';

interface AuthState {
  status: Status;
  user: UserDTO | null;
  /** Shown once after setup/registration, then cleared. */
  recoveryCodes: string[] | null;
  signIn: (res: AuthResponse) => void;
  signOut: () => Promise<void>;
  setUser: (user: UserDTO) => void;
  dismissRecoveryCodes: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserDTO | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (hasStoredSession()) {
          const ok = await refreshSession();
          if (ok) {
            const me = await api.get<UserDTO>('/me');
            saveSnapshot('me', me);
            if (!cancelled) {
              setUser(me);
              setStatus('signedIn');
            }
            return;
          }
          // Still holding a token means the refresh failed for network reasons, not rejection.
          // Open with the last-known profile so entries can still be recorded offline.
          if (hasStoredSession()) {
            const cached = loadSnapshot<UserDTO>('me');
            if (!cancelled) {
              if (cached) setUser(cached);
              setStatus(cached ? 'signedIn' : 'offline');
            }
            return;
          }
        }
        const { setupRequired } = await api.get<{ setupRequired: boolean }>('/auth/status');
        if (!cancelled) setStatus(setupRequired ? 'setup' : 'signedOut');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const clearLocal = useCallback(() => {
    setTokens(null);
    clearSnapshots();
    clearAllLocks(); // the app lock belongs to the signed-in session on this device
    setUser(null);
    setStatus('signedOut');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => onSessionEnded(clearLocal), [clearLocal]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      recoveryCodes,
      signIn: (res) => {
        setTokens(res);
        clearSnapshots();
        saveSnapshot('me', res.user);
        queryClient.clear();
        setUser(res.user);
        setRecoveryCodes(res.recoveryCodes ?? null);
        setStatus('signedIn');
      },
      signOut: async () => {
        const refreshToken = storedRefreshToken();
        if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
        clearLocal();
      },
      setUser: (next) => {
        saveSnapshot('me', next);
        setUser(next);
      },
      dismissRecoveryCodes: () => setRecoveryCodes(null),
      retry: () => {
        setStatus('loading');
        setAttempt((n) => n + 1);
      },
    }),
    [status, user, recoveryCodes, queryClient, clearLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
