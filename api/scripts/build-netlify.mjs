// Bundles the API (including the shared workspace package) into one ESM file that Netlify deploys as-is.
// Netlify's own bundler mishandles the TypeScript workspace package, so we hand it plain JavaScript.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}netlify/functions`;

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: { api: `${root}netlify/entry.ts` },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  // The MongoDB driver is CommonJS and calls require(); give the ESM bundle a real require.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Optional MongoDB driver add-ons we don't use; the driver loads them lazily.
  external: [
    'kerberos',
    '@mongodb-js/zstd',
    'snappy',
    'mongodb-client-encryption',
    '@aws-sdk/credential-providers',
    'gcp-metadata',
    'socks',
    'aws4',
  ],
  logLevel: 'info',
});
