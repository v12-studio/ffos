import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/lib/push.ts';

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** What the browser does on receiving a push (RFC 8291), to check our encryption from the other side. */
function decryptAsBrowser(body: Buffer, uaPrivate: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  expect(recordSize).toBe(4096);

  const uaPublic = uaPrivate.getPublicKey();
  const shared = uaPrivate.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

describe('web push', () => {
  it('encrypts a message that only the subscribed browser can read', () => {
    const browser = createECDH('prime256v1');
    browser.generateKeys();
    const auth = randomBytes(16);
    const target = { p256dh: browser.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
    const message = JSON.stringify({ title: 'Rent due tomorrow', body: '₹15,000 · Home' });

    const body = encryptPayload(target, message);
    expect(decryptAsBrowser(body, browser, auth)).toBe(message);
    // A fresh key and salt each time.
    expect(encryptPayload(target, message).equals(body)).toBe(false);
  });

  it('signs a VAPID header the push service can check', () => {
    const keys = { ...generateVapidKeys(), subject: 'https://family.example' };
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', keys, Date.UTC(2026, 10, 27));
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt!.split('.');
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://family.example' });
    expect(claims.exp).toBe(Math.floor(Date.UTC(2026, 10, 27) / 1000) + 12 * 3600);

    const pub = Buffer.from(keys.publicKey, 'base64url');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'))).toBe(true);
  });
});
