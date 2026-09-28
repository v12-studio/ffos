// Bundles the API into Vercel's Build Output API v3 format (.vercel/output).
// Vercel uses this output directly when the build command produces it.
import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/index.func`;

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: [`${root}src/vercel.ts`],
  outfile: `${fn}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
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

// The api package is "type": "module"; mark the CJS bundle as CommonJS.
await writeFile(`${fn}/package.json`, JSON.stringify({ type: 'commonjs' }));
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 15 }),
);
await writeFile(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }));
console.log('Vercel output written to api/.vercel/output');
