import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiErrorBody } from '@ffos/shared';
import type { AppEnv } from './context.ts';
import { collections } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './lib/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { booksRoutes } from './routes/books.ts';
import { inviteRoutes } from './routes/invites.ts';
import { meRoutes } from './routes/me.ts';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: (origin) => (env().corsOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  v1.use('*', async (c, next) => {
    c.set('db', await collections());
    await next();
  });
  v1.route('/auth', authRoutes);
  v1.route('/me', meRoutes);
  v1.route('/invites', inviteRoutes);
  v1.route('/books', booksRoutes);
  app.route('/api/v1', v1);

  app.notFound((c) => c.json<ApiErrorBody>({ error: { code: 'not_found', message: 'Not found' } }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json<ApiErrorBody>(
        { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
        err.status,
      );
    }
    if (err instanceof SyntaxError) {
      return c.json<ApiErrorBody>({ error: { code: 'bad_request', message: 'Invalid JSON body' } }, 400);
    }
    console.error(err);
    return c.json<ApiErrorBody>({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });

  return app;
}
