import type { ApiErrorBody } from '@ffos/shared';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
const REFRESH_KEY = 'ffos.refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

// Access token lives only in memory; the refresh token persists so the installed app stays signed in.
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const sessionEndedListeners = new Set<() => void>();

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  accessToken = tokens?.accessToken ?? null;
  try {
    if (tokens) localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until the tab closes.
  }
}

export const hasStoredSession = () => readRefresh() !== null;
export const storedRefreshToken = readRefresh;

/** Called when the session can't be renewed (expired, revoked, password changed elsewhere). */
export function onSessionEnded(listener: () => void) {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = readRefresh();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      if (res.status === 401) setTokens(null);
      return false;
    }
    setTokens(await res.json());
    return true;
  } catch {
    return false; // offline: keep the stored token and try again later
  }
}

/**
 * Refresh tokens rotate on every use, so two tabs refreshing at once would lock one out.
 * A cross-tab Web Lock serialises refreshes; each waiter re-reads the latest token from storage.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const run: Promise<boolean> = navigator.locks
    ? navigator.locks.request('ffos-refresh', () => doRefresh()).then((ok) => ok)
    : doRefresh();
  refreshInFlight = run.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Sends an authenticated request, renewing the session once on 401. Throws ApiError on failure. */
async function send(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  // Auth endpoints (login, setup…) answer 401 for bad credentials; never treat that as an expired session.
  const canRefresh = retry && !path.startsWith('/auth/') && readRefresh() !== null;
  if (!accessToken && canRefresh) await refreshSession();

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection.");
  }

  if (res.status === 401 && canRefresh) {
    if (await refreshSession()) return send(method, path, body, false);
    if (!readRefresh()) sessionEndedListeners.forEach((l) => l());
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `Request failed (${res.status})`, err?.fields);
  }
  return res;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => null)) as T;
}

/** Downloads a file from the API and hands it to the browser as `filename`. */
export async function download(path: string, filename: string) {
  const blob = await (await send('GET', path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Give mobile browsers time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
