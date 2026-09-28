// Vercel serverless entry (bundled by scripts/build-vercel.mjs).
import { getRequestListener } from '@hono/node-server';
import { createApp } from './app.ts';

export default getRequestListener(createApp().fetch);
