import { existsSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthResponse } from '@ffos/shared';
import { createApp } from '../src/app.ts';
import { closeDb, collections } from '../src/db.ts';
import { resetEnv } from '../src/env.ts';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;

export async function startTestApi() {
  // Reuse a locally installed mongod if available; otherwise mongodb-memory-server downloads one (CI).
  if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync('/usr/bin/mongod')) {
    process.env.MONGOMS_SYSTEM_BINARY = '/usr/bin/mongod';
  }
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = 'ffos_test';
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  resetEnv();
  app = createApp();
}

export async function stopTestApi() {
  await closeDb();
  await mongo?.stop();
}

export async function resetDb() {
  const db = await collections();
  await Promise.all(Object.values(db).map((col) => col.deleteMany({})));
}

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let phoneSeq = 9_000_000_000;
export const nextPhone = () => `+91${phoneSeq++}`;

export async function setupOwner() {
  const res = await api<AuthResponse>('POST', '/auth/setup', {
    body: { name: 'Owner', phone: nextPhone(), password: 'password123' },
  });
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createBook(token: string, name: string) {
  const res = await api('POST', '/books', { token, body: { name } });
  if (res.status !== 201) throw new Error(`create book failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

export async function invite(token: string, bookId: string, role: string, phone?: string) {
  const res = await api('POST', `/books/${bookId}/invites`, { token, body: { role, ...(phone ? { phone } : {}) } });
  if (res.status !== 201) throw new Error(`invite failed: ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

/** Registers a brand-new user through an invite to `bookId` with `role`. */
export async function registerMember(ownerToken: string, bookId: string, role: string, name = role) {
  const inviteToken = await invite(ownerToken, bookId, role);
  const res = await api<AuthResponse>('POST', '/auth/register', {
    body: { inviteToken, name, phone: nextPhone(), password: 'password123' },
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function expenseCategoryId(token: string, bookId: string) {
  const res = await api('GET', `/books/${bookId}/categories`, { token });
  return (res.body as { id: string; kind: string }[]).find((c) => c.kind === 'expense')!.id;
}
