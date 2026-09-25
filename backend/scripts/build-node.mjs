#!/usr/bin/env node
/**
 * Bundles the API into one CommonJS file for Node.js hosting (host.md / Plesk Passenger).
 * Output: dist/node/{app.js, app.js.map, package.json, tmp/restart.txt}
 * No `npm install` is needed on the server — every dependency is inlined.
 */
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const OUT = 'dist/node';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/tmp`, { recursive: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: `${OUT}/app.js`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: true,
  keepNames: true,
  legalComments: 'none',
  // Optional MongoDB add-ons the driver loads only when configured (all try/catch-guarded).
  external: [
    'kerberos',
    '@mongodb-js/zstd',
    'snappy',
    'socks',
    'aws4',
    'mongodb-client-encryption',
    'gcp-metadata',
    '@aws-sdk/credential-providers',
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await writeFile(
  `${OUT}/package.json`,
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'commonjs',
      main: 'app.js',
      engines: { node: '>=20.19' },
      scripts: { start: 'node app.js' },
    },
    null,
    2,
  )}\n`,
);
// Passenger restarts the app when this file's mtime changes.
await writeFile(`${OUT}/tmp/restart.txt`, `${new Date().toISOString()}\n`);
console.info(`[build-node] ${OUT}/app.js ready — upload the folder as the Plesk application root.`);
