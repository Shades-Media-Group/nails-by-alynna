import { describe, expect, it } from 'vitest';
import logoSvg from '@/assets/brand/logo.svg?raw';
import indexHtml from '../../../index.html?raw';
import {
  LAUNCH_SCREENS,
  SPLASH_LOGO,
  SPLASH_SCREENS,
  launchScreenSize,
  splashFileName,
  splashLinkTags,
  splashLogoRect,
} from '../../../scripts/brand-assets.mjs';

// The in-page splash draws logo.svg as is, so its viewBox is the box both splashes place.
const [x = 0, y = 0, w = 0, h = 0] = (/viewBox="([^"]+)"/.exec(logoSvg)?.[1] ?? '')
  .split(' ')
  .map(Number);
const logoBox = { x, y, w, h };
const percent = (fraction: number) => Math.round(fraction * 100);

describe('iOS launch images', () => {
  it('cover every screen in both orientations', () => {
    expect(LAUNCH_SCREENS).toHaveLength(SPLASH_SCREENS.length * 2);
    const files = LAUNCH_SCREENS.map(splashFileName);
    expect(new Set(files).size).toBe(files.length);
    // iPhone 17 Pro: 402 × 874 pt at 3×.
    expect(files).toContain('splash/apple-splash-1206x2622.png');
    expect(files).toContain('splash/apple-splash-2622x1206.png');
  });

  it('are linked with the portrait device size and the orientation they are for', () => {
    const links = splashLinkTags().split('\n');
    expect(links).toHaveLength(LAUNCH_SCREENS.length);
    const media = (file: string) => links.find((link) => link.includes(`href="/splash/${file}"`));
    expect(media('apple-splash-1206x2622.png')).toContain(
      'media="screen and (device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"',
    );
    expect(media('apple-splash-2622x1206.png')).toContain(
      'media="screen and (device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"',
    );
  });

  it('centre the logo, 46% of the width in portrait and 30% of the height in landscape', () => {
    const portrait = splashLogoRect({ width: 402, height: 874 }, logoBox);
    expect(portrait.width).toBeCloseTo(402 * 0.46);
    expect(portrait.height).toBeCloseTo((portrait.width * h) / w);
    expect(portrait.x + portrait.width / 2).toBeCloseTo(201);
    expect(portrait.y + portrait.height / 2).toBeCloseTo(437);

    const landscape = splashLogoRect({ width: 874, height: 402 }, logoBox);
    expect(landscape.height).toBeCloseTo(402 * 0.3);
    expect(landscape.y + landscape.height / 2).toBeCloseTo(201);

    // An iPad stops at 240 px.
    expect(splashLogoRect({ width: 1024, height: 1366 }, logoBox).width).toBe(240);
  });

  it('size and centre the logo like the in-page splash (index.html)', () => {
    const rule = /\.splash__logo\s*\{([^}]*)\}/.exec(indexHtml)?.[1] ?? '';
    expect(rule).toContain(
      `width: min(${percent(SPLASH_LOGO.width)}cqw, ${SPLASH_LOGO.maxWidth}px);`,
    );
    // The splash box is the page; the screen is the page plus the status bar above it (splashGate.ts).
    expect(rule).toContain(
      `max-height: calc((100cqh + var(--splash-status-bar, 0px)) * ${SPLASH_LOGO.maxHeight});`,
    );
    expect(rule).toContain('translate: 0 calc(var(--splash-status-bar, 0px) / -2);');
    expect(launchScreenSize({ w: 402, h: 874, dpr: 3, orientation: 'landscape' })).toEqual({
      width: 874,
      height: 402,
    });
  });
});
