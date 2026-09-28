// Device-level app lock: a PIN (hashed with PBKDF2, never sent to the server) plus optional
// biometrics through WebAuthn with a platform authenticator (fingerprint, Face ID, Windows Hello).
// Like a banking app's lock screen it guards this device's signed-in session; it is not a server login.

const PREFIX = 'ffos.lock.';
const ITERATIONS = 210_000;

export const LOCK_TIMEOUTS = [
  { minutes: 0, label: 'Immediately' },
  { minutes: 1, label: 'After 1 minute' },
  { minutes: 5, label: 'After 5 minutes' },
  { minutes: 15, label: 'After 15 minutes' },
] as const;

export const MAX_ATTEMPTS = 10;
const FREE_ATTEMPTS = 5;

export interface LockConfig {
  pinHash: string;
  salt: string;
  iterations: number;
  pinLength: number;
  /** WebAuthn credential id (base64url) when biometrics are turned on. */
  credentialId?: string;
  timeoutMin: number;
  failedAttempts: number;
  /** Epoch ms until which PIN entry is paused after repeated failures. */
  blockedUntil?: number;
}

export function readLock(userId: string): LockConfig | null {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    return raw ? (JSON.parse(raw) as LockConfig) : null;
  } catch {
    return null;
  }
}

export function writeLock(userId: string, config: LockConfig | null) {
  try {
    if (config) localStorage.setItem(PREFIX + userId, JSON.stringify(config));
    else localStorage.removeItem(PREFIX + userId);
  } catch {
    // Storage unavailable: the lock can't persist, which only means it won't be enforced.
  }
}

/** Removes every account's lock on this device (used on sign-out). */
export function clearAllLocks() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ── PIN ──

const toB64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function derive(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return toB64(bits);
}

export async function createLock(pin: string, timeoutMin = 1): Promise<LockConfig> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    pinHash: await derive(pin, salt, ITERATIONS),
    salt: toB64(salt),
    iterations: ITERATIONS,
    pinLength: pin.length,
    timeoutMin,
    failedAttempts: 0,
  };
}

export async function pinMatches(config: LockConfig, pin: string) {
  return (await derive(pin, fromB64(config.salt), config.iterations)) === config.pinHash;
}

/** After FREE_ATTEMPTS wrong PINs, wait 30s, 60s, 2m, 4m… before the next try. */
export function blockAfterFailure(failedAttempts: number): number | undefined {
  if (failedAttempts < FREE_ATTEMPTS) return undefined;
  return Date.now() + 30_000 * 2 ** (failedAttempts - FREE_ATTEMPTS);
}

// ── biometrics (WebAuthn platform authenticator) ──

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      window.isSecureContext &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** A friendly name for the device's biometric, for button labels. */
export function biometricLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Face ID / Touch ID';
  if (/Mac OS/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  return 'fingerprint / face unlock';
}

export async function registerBiometrics(user: { id: string; name: string; phone: string }): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Family Finance OS' },
      user: { id: new TextEncoder().encode(user.id), name: user.phone, displayName: user.name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Biometric setup was cancelled');
  return toB64(credential.rawId);
}

/** Resolves true only if the device verified the user (fingerprint/face/device PIN). */
export async function verifyBiometrics(credentialId: string): Promise<boolean> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) as BufferSource, transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return false;
  // authenticatorData byte 32 holds the flags; 0x04 = "user verified".
  const data = new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData);
  return (data[32]! & 0x04) !== 0;
}
