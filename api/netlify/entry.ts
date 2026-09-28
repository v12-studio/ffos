// Netlify Functions entry (bundled by scripts/build-netlify.mjs): every /api/* request goes to the Hono app.
import { createApp } from '../src/app.ts';

const app = createApp();

export default (request: Request) => app.fetch(request);

export const config = { path: '/api/*' };
