/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import { BRAND_BACKGROUND, generateBrandAssets, splashLinkTags } from './scripts/brand-assets.mjs';
import { SPLASH_GATE_SCRIPT } from './src/components/brand/splashGate.ts';

const src = fileURLToPath(new URL('./src', import.meta.url));

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return ''; // Not a git checkout.
  }
}

interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
  changes: string[];
}

/** Build id: yyyymmddhhmm-<git sha>, overridable with APP_VERSION (the deploy script sets it). */
function buildInfo(): BuildInfo {
  const commit = git('rev-parse --short HEAD') || 'local';
  const builtAt = new Date().toISOString();
  const version = process.env.APP_VERSION || `${builtAt.replace(/[-:T]/g, '').slice(0, 12)}-${commit}`;
  const changes = git('log -10 --pretty=format:%h%x20%s').split('\n').filter(Boolean);
  return { version, commit, builtAt, changes };
}

/**
 * Inline splash logo with a single gloss sweep (the brand's "fresh coat" moment). The
 * highlight is clipped to the letterforms: each path gets an id and the clip-path <use>s
 * them individually, as SVG only allows shapes (not groups) inside a clipPath.
 */
function splashSvg(): string {
  const svg = readFileSync(`${src}/assets/brand/logo.svg`, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 852 800';
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"\/>/g)];
  const art = paths.map((m, i) => `<path id="sl${i}" d="${m[1]}" fill="${m[2]}"/>`).join('');
  const clip = paths.map((_, i) => `<use href="#sl${i}"/>`).join('');
  return (
    `<svg class="splash__logo" viewBox="${viewBox}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><clipPath id="splash-clip">${clip}</clipPath>` +
    `<linearGradient id="splash-gloss-fill" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `${art}<g clip-path="url(#splash-clip)"><rect class="splash__gloss" x="-420" y="-40" width="260" height="900" fill="url(#splash-gloss-fill)"/></g></svg>`
  );
}

/** The CSP allows no inline script except the splash gate, by its hash. */
const SPLASH_GATE_CSP = `'sha256-${createHash('sha256').update(SPLASH_GATE_SCRIPT).digest('base64')}'`;

/**
 * Icons, favicon and iOS launch screens from brand/logo.svg, the inline splash logo, and the
 * splash gate (splashGate.ts) with its hash added to `script-src` in the built _headers.
 */
function brandPlugin(): Plugin {
  let headersFile: string | null = null;
  return {
    name: 'nba:brand',
    configResolved(config) {
      if (config.command === 'build') headersFile = resolve(config.root, config.build.outDir, '_headers');
    },
    async buildStart() {
      await generateBrandAssets({ log: (m: string) => this.info(m) });
    },
    transformIndexHtml(html) {
      return html
        .replace('<!--splash-logo-->', splashSvg())
        .replace('<!--apple-splash-links-->', splashLinkTags())
        .replace('<!--splash-gate-->', `<script>${SPLASH_GATE_SCRIPT}</script>`);
    },
    async closeBundle() {
      if (!headersFile) return;
      const headers = await readFile(headersFile, 'utf8');
      if (!headers.includes("script-src 'self';")) throw new Error(`${headersFile}: no "script-src 'self';" to add the splash gate hash to`);
      await writeFile(headersFile, headers.replace("script-src 'self';", `script-src 'self' ${SPLASH_GATE_CSP};`));
    },
  };
}

/**
 * The dev server (`yarn dev:lan`, opened on a phone) behaves like the real app too: it serves
 * the manifest, so "Add to Home Screen" gives a full-screen app instead of a browser window,
 * and a /version.json that changes whenever a source file is saved, so an app left open in
 * the background offers "Update" when it comes back.
 */
const RETIRE_SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

function devAppPlugin(): Plugin {
  let version = `dev-${Date.now()}`;
  return {
    name: 'nba:dev-app',
    apply: 'serve',
    configureServer(server) {
      server.watcher.on('change', () => {
        version = `dev-${Date.now()}`;
      });
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(MANIFEST));
          return;
        }
        // A service worker left over from a production build (vite preview, or the live site on
        // the same address) would keep serving that old build. The dev server answers its update
        // check with one that removes itself, empties its caches and reloads the page.
        if (path === '/sw.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(RETIRE_SERVICE_WORKER);
          return;
        }
        if (path === '/version.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ service: 'nails-by-alynna-web', version, dev: true }));
          return;
        }
        next();
      });
    },
    transformIndexHtml(html) {
      return html.replace('</head>', '    <link rel="manifest" href="/manifest.webmanifest" />\n  </head>');
    },
  };
}

/** version.json: which build is live and what changed (deploy checks, /health, admin). */
function versionPlugin(info: BuildInfo): Plugin {
  return {
    name: 'nba:version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ service: 'nails-by-alynna-web', ...info }, null, 2)}\n`,
      });
    },
  };
}

/** The installed app: name, icons, start page (the app decides where to go), standalone window. */
const MANIFEST: Partial<ManifestOptions> = {
  id: '/',
  name: 'Nails by Alynna',
  short_name: 'Nails by Alynna',
  description: 'Book your nails at Nails by Alynna, Chișinău: manicure, pedicure, extensions and nail art.',
  lang: 'ro',
  dir: 'ltr',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'portrait',
  background_color: BRAND_BACKGROUND,
  theme_color: '#FFFFFF',
  categories: ['beauty', 'lifestyle'],
  icons: [
    { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
    { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Programează-te', short_name: 'Book', url: '/book', icons: [{ src: '/icons/pwa-192x192.png', sizes: '192x192' }] },
    { name: 'Programările mele', short_name: 'Bookings', url: '/bookings', icons: [{ src: '/icons/pwa-192x192.png', sizes: '192x192' }] },
  ],
};

const ADMIN_MODULE = /[\\/]src[\\/](admin)[\\/]|[\\/]locales[\\/][a-z]{2}[\\/]admin\.json$/;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const build = buildInfo();
  const apiTarget = env.VITE_API_PROXY || 'http://127.0.0.1:8787';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(build.version),
      __APP_COMMIT__: JSON.stringify(build.commit),
      __APP_BUILT_AT__: JSON.stringify(build.builtAt),
    },
    resolve: {
      alias: {
        '@': src,
        // MUI's free Rounded icons without the MUI/emotion runtime: icons only need
        // createSvgIcon, which our 1 kB shim provides (see src/components/ui/icons/SvgIcon.tsx).
        '@mui/material/SvgIcon': `${src}/components/ui/icons/SvgIcon.tsx`,
      },
    },
    server: {
      port: 5180,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    build: {
      sourcemap: 'hidden',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 400,
      rolldownOptions: {
        output: {
          // Everything only the dashboard needs lives under assets/admin/ so the installed
          // client app never precaches or downloads it.
          chunkFileNames: (chunk) =>
            chunk.moduleIds.some((id) => ADMIN_MODULE.test(id))
              ? 'assets/admin/[name]-[hash].js'
              : 'assets/[name]-[hash].js',
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      brandPlugin(),
      versionPlugin(build),
      devAppPlugin(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        strategies: 'generateSW',
        manifestFilename: 'manifest.webmanifest',
        includeAssets: ['favicon.svg', 'favicon.ico', 'robots.txt', 'icons/apple-touch-icon-180x180.png'],
        manifest: MANIFEST,
        workbox: {
          // Web Push: push / notificationclick handlers (public/push-sw.js; production builds only).
          importScripts: ['push-sw.js'],
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
          // Admin code, launch screens and the version probe stay out of the install.
          globIgnores: [
            '**/assets/admin/**',
            '**/splash/**',
            'version.json',
            // Onest subsets the app never renders (ro/ru/en need latin, latin-ext, cyrillic).
            '**/onest-{math,symbols,vietnamese}-*.woff2',
          ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/assets/admin/'),
              handler: 'CacheFirst',
              options: { cacheName: 'nba-admin', expiration: { maxEntries: 80, maxAgeSeconds: 30 * 86_400 } },
            },
            {
              urlPattern: ({ url }) => ['/api/config', '/api/catalog', '/api/staff'].includes(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'nba-public-api',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 10, maxAgeSeconds: 7 * 86_400 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Let Vite resolve the MUI icon modules so the SvgIcon alias applies in tests too.
      server: { deps: { inline: [/@mui\/icons-material/] } },
    },
  };
});
