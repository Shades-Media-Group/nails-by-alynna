#!/usr/bin/env node
/**
 * Brand asset pipeline — one source logo, every size the app needs.
 *
 *   brand/logo.svg  (source of truth, supplied by the studio)
 *     → src/assets/brand/logo.svg       optimised lockup used in the app      (committed)
 *     → src/assets/brand/mark.svg       "nails by alynna" (no NAIL SALON line) for compact spots (committed)
 *     → public/favicon.svg, favicon.ico, icons/*.png  PWA + browser icons   (generated)
 *     → public/splash/*.png             iOS launch screens (apple-touch-startup-image)
 *
 * Runs automatically before `dev` and `build` (skips work when nothing changed), so every
 * deploy ships icons and launch screens that match the current logo.
 * Usage: node scripts/brand-assets.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'brand/logo.svg');
const OUT_APP = resolve(root, 'src/assets/brand');
const OUT_PUBLIC = resolve(root, 'public');
const STAMP = resolve(OUT_PUBLIC, 'icons/.stamp');

/** Blush field from the brand palette — also the splash and manifest background. */
export const BRAND_BACKGROUND = '#FDE7FC';

/** Portrait launch screens for current iPhones and iPads (CSS px × device pixel ratio). */
export const SPLASH_SCREENS = [
  { w: 440, h: 956, dpr: 3 }, // iPhone 16/17 Pro Max
  { w: 402, h: 874, dpr: 3 }, // iPhone 16/17 Pro, iPhone 17
  { w: 420, h: 912, dpr: 3 }, // iPhone Air
  { w: 430, h: 932, dpr: 3 }, // iPhone 14/15 Pro Max, 15/16 Plus
  { w: 393, h: 852, dpr: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { w: 390, h: 844, dpr: 3 }, // iPhone 12/13/14, 12/13 Pro
  { w: 428, h: 926, dpr: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { w: 375, h: 812, dpr: 3 }, // iPhone X/XS/11 Pro, 12/13 mini
  { w: 414, h: 896, dpr: 3 }, // iPhone XS Max, 11 Pro Max
  { w: 414, h: 896, dpr: 2 }, // iPhone XR, 11
  { w: 414, h: 736, dpr: 3 }, // iPhone 8 Plus
  { w: 375, h: 667, dpr: 2 }, // iPhone SE (2nd/3rd gen), 8
  { w: 744, h: 1133, dpr: 2 }, // iPad mini
  { w: 820, h: 1180, dpr: 2 }, // iPad Air, iPad (10th gen)
  { w: 834, h: 1194, dpr: 2 }, // iPad Pro 11"
  { w: 1024, h: 1366, dpr: 2 }, // iPad Pro 12.9"
];

export const splashFileName = (s) => `splash/apple-splash-${s.w * s.dpr}x${s.h * s.dpr}.png`;

export function splashLinkTags() {
  return SPLASH_SCREENS.map(
    (s) =>
      `<link rel="apple-touch-startup-image" href="/${splashFileName(s)}" media="screen and (device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)">`,
  ).join('\n    ');
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

const round = (d) => d.replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));

function parsePaths(svg) {
  return [...svg.matchAll(/<path d="([^"]+)"(?: fill-rule="[^"]+")? fill="(#[0-9A-Fa-f]{6})"\/>/g)].map((m) => {
    const d = m[1];
    const [, , firstY] = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(d) ?? [];
    return { d: round(d), fill: m[2].toUpperCase(), firstY: Number(firstY) };
  });
}

function bbox(paths) {
  const xs = [];
  const ys = [];
  for (const p of paths) {
    const nums = (p.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(nums[i]);
      ys.push(nums[i + 1]);
    }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const pathsMarkup = (paths) => paths.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('');

function standaloneSvg(paths, box, title) {
  const vb = `${Math.floor(box.x)} ${Math.floor(box.y)} ${Math.ceil(box.w) + 1} ${Math.ceil(box.h) + 1}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}"><title>${title}</title>${pathsMarkup(paths)}</svg>\n`;
}

/** Places artwork (with its own viewBox) centred on a canvas. */
function composeSvg({ width, height, background, radius = 0, art, artBox, artWidth }) {
  const scale = artWidth / artBox.w;
  const drawnH = artBox.h * scale;
  const tx = (width - artWidth) / 2 - artBox.x * scale;
  const ty = (height - drawnH) / 2 - artBox.y * scale;
  const bg = background
    ? `<rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">${art}</g></svg>`;
}

/** Minimal ICO writer with an embedded PNG (supported by every current browser). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export async function generateBrandAssets({ force = false, log = console.info } = {}) {
  const [source, script] = await Promise.all([readFile(SOURCE, 'utf8'), readFile(fileURLToPath(import.meta.url), 'utf8')]);
  const hash = createHash('sha256').update(source).update(script).digest('hex').slice(0, 16);
  if (!force) {
    const previous = await readFile(STAMP, 'utf8').catch(() => '');
    if (previous.trim() === hash) return { skipped: true };
  }

  const { default: sharp } = await import('sharp');
  const paths = parsePaths(source);
  if (paths.length < 10) throw new Error(`brand/logo.svg: expected the logo paths, found ${paths.length}`);

  // Rows of the lockup: "nails" (with brush and polish drop) above y≈550, "by alynna" down to
  // y≈735, then the small "— NAIL SALON —" line. Icons keep "nails by alynna" together; the
  // tagline line would be illegible at icon sizes.
  const mark = paths.filter((p) => p.firstY < 750);
  const lockupBox = bbox(paths);
  const markBox = bbox(mark);

  await mkdir(OUT_APP, { recursive: true });
  await mkdir(resolve(OUT_PUBLIC, 'icons'), { recursive: true });
  await mkdir(resolve(OUT_PUBLIC, 'splash'), { recursive: true });

  await writeFile(resolve(OUT_APP, 'logo.svg'), standaloneSvg(paths, lockupBox, 'Nails by Alynna'));
  await writeFile(resolve(OUT_APP, 'mark.svg'), standaloneSvg(mark, markBox, 'Nails by Alynna'));

  const art = pathsMarkup(mark);
  const lockupArt = pathsMarkup(paths);
  const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 });

  // Favicon: rounded blush tile with "nails by alynna".
  const faviconSvg = composeSvg({ width: 64, height: 64, background: BRAND_BACKGROUND, radius: 14, art, artBox: markBox, artWidth: 52 });
  await writeFile(resolve(OUT_PUBLIC, 'favicon.svg'), `${faviconSvg}\n`);
  const favicon48 = await png(composeSvg({ width: 48, height: 48, background: BRAND_BACKGROUND, radius: 11, art, artBox: markBox, artWidth: 39 })).toBuffer();
  await writeFile(resolve(OUT_PUBLIC, 'favicon.ico'), pngToIco(favicon48, 48));

  const icons = [
    // "any": rounded tile (browsers and desktop show it as-is)
    { file: 'icons/pwa-64x64.png', size: 64, radius: 0.22, art: 0.78 },
    { file: 'icons/pwa-192x192.png', size: 192, radius: 0.22, art: 0.7 },
    { file: 'icons/pwa-512x512.png', size: 512, radius: 0.22, art: 0.7 },
    // maskable: full-bleed, artwork inside the 80% safe circle
    { file: 'icons/maskable-icon-512x512.png', size: 512, radius: 0, art: 0.52 },
    // iOS rounds the corners itself
    { file: 'icons/apple-touch-icon-180x180.png', size: 180, radius: 0, art: 0.66 },
  ];
  for (const icon of icons) {
    const svg = composeSvg({
      width: icon.size,
      height: icon.size,
      background: BRAND_BACKGROUND,
      radius: icon.size * icon.radius,
      art,
      artBox: markBox,
      artWidth: icon.size * icon.art,
    });
    await png(svg).toFile(resolve(OUT_PUBLIC, icon.file));
  }

  // iOS launch screens mirror the in-app splash: blush field, full logo lockup centred.
  await Promise.all(
    SPLASH_SCREENS.map((s) => {
      const width = s.w * s.dpr;
      const height = s.h * s.dpr;
      const artWidth = Math.min(width * 0.46, height * 0.3 * (lockupBox.w / lockupBox.h), 240 * s.dpr);
      const svg = composeSvg({ width, height, background: BRAND_BACKGROUND, art: lockupArt, artBox: lockupBox, artWidth });
      return png(svg).toFile(resolve(OUT_PUBLIC, splashFileName(s)));
    }),
  );

  await writeFile(STAMP, `${hash}\n`);
  log(`[brand] generated logo, mark, favicon, ${icons.length} icons and ${SPLASH_SCREENS.length} launch screens`);
  return { skipped: false };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  generateBrandAssets({ force: process.argv.includes('--force') }).then(
    (r) => r.skipped && console.info('[brand] assets up to date'),
    (error) => {
      console.error('[brand] failed:', error);
      process.exit(1);
    },
  );
}
