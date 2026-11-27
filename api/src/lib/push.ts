import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

// Web Push without a library: payload encryption (RFC 8291, aes128gcm) and the VAPID header (RFC 8292).
// Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (base64url, from `npm run vapid-keys -w api`); without them
// notifications stay switched off and the app says so.

export interface PushTarget {
  endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** The browser's auth secret, base64url (16 bytes). */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Who to contact about these notifications: an https URL or mailto:. */
  subject: string;
}

export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const origin = (process.env.CORS_ORIGINS ?? '').split(',')[0]?.trim();
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || (origin?.startsWith('https://') ? origin : 'https://example.invalid') };
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** A new VAPID key pair (P-256), base64url. */
export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** Encrypts `payload` for one browser (RFC 8291): salt, record size, our ephemeral public key, then the ciphertext. */
export function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, payload: string): Buffer {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record; 0x02 marks it as the last.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** The Authorization header value proving these notifications come from us (RFC 8292, ES256 JWT). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const pub = fromB64url(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) };
  const key = createPrivateKey({ key: jwk, format: 'jwk' });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped, relative to the app (e.g. "#/budget"). */
  url?: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
}

/** Sends one notification. Returns 'gone' when the browser has dropped the subscription (delete it). */
export async function sendPush(target: PushTarget, message: PushMessage, keys: VapidKeys): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(24 * 3600),
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidAuthorization(target.endpoint, keys),
      },
      body: new Uint8Array(encryptPayload(target, JSON.stringify(message))),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
