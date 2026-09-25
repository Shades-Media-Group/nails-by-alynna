import { useId } from 'react';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import type { ServiceArt } from '@/types/api';
import { NATURAL, PaintContext, WHITE, mix, type Paint, type PaintName } from './paint';
import { Scene } from './scenes';

/**
 * The realistic service illustrations: manicured fingers, toes and tools in glossy vector, in a
 * 100×100 box. Used where clients choose services (Services page, booking flow, Popular on
 * Home); everywhere else keeps the classic `NailArt`. Same props, same stored `art` values; the
 * polish takes the category's swatch colour. Gradients only (no filters), so a list stays cheap.
 *
 * Fingers run past the bottom of the box on purpose: put it in a tile with `overflow-hidden`
 * and the tile's edge crops them, like a photo, instead of showing where a finger ends.
 */

interface Props {
  art: ServiceArt;
  color: SwatchColor;
  className?: string;
  /** Adds the one-time gloss sweep (e.g. on the booking confirmation). */
  shine?: boolean;
}

export function RealisticNailArt({ art, color, className, shine }: Props) {
  const uid = useId();
  const swatch = SWATCH[color].hex;
  const id = (name: string) => `${uid}${name}`;
  const paint: Paint = {
    accent: swatch.accent,
    deep: swatch.deep,
    field: swatch.field,
    tint: mix(swatch.accent, WHITE, 0.45),
    id,
    url: (name: PaintName) => `url(#${id(name)})`,
  };
  return (
    <svg viewBox="0 0 100 100" className={cx('block', className)} style={{ overflow: 'visible' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id('polish')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(swatch.accent, WHITE, 0.2)} />
          <stop offset="0.45" stopColor={swatch.accent} />
          <stop offset="1" stopColor={mix(swatch.accent, swatch.deep, 0.35)} />
        </linearGradient>
        {/* The nail's dome: its sides and base turn away from the light. */}
        <radialGradient id={id('dome')} cx="0.42" cy="0.4" r="0.72">
          <stop offset="0.6" stopColor={swatch.deep} stopOpacity="0" />
          <stop offset="1" stopColor={swatch.deep} stopOpacity="0.5" />
        </radialGradient>
        <radialGradient id={id('domeNude')} cx="0.42" cy="0.4" r="0.72">
          <stop offset="0.6" stopColor="#B98274" stopOpacity="0" />
          <stop offset="1" stopColor="#B98274" stopOpacity="0.4" />
        </radialGradient>
        {/* The one soft highlight: brightest in its middle, fading out at both ends. */}
        <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WHITE} stopOpacity="0.15" />
          <stop offset="0.3" stopColor={WHITE} stopOpacity="0.85" />
          <stop offset="0.7" stopColor={WHITE} stopOpacity="0.6" />
          <stop offset="1" stopColor={WHITE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('natural')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={NATURAL.bed} />
          <stop offset="1" stopColor={NATURAL.bedDeep} />
        </linearGradient>
        {/* French base: a sheer natural pink (a swatch tint turns it grey on cyan and mint). */}
        <linearGradient id={id('nude')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(NATURAL.bed, WHITE, 0.2)} />
          <stop offset="1" stopColor={NATURAL.bedDeep} />
        </linearGradient>
        {shine ? (
          <linearGradient id={id('sweep')} x1="0" x2="1">
            <stop offset="0" stopColor={WHITE} stopOpacity="0" />
            <stop offset="0.5" stopColor={WHITE} stopOpacity="0.55" />
            <stop offset="1" stopColor={WHITE} stopOpacity="0" />
          </linearGradient>
        ) : null}
      </defs>
      <PaintContext value={paint}>
        <Scene art={art} />
      </PaintContext>
      {shine ? <rect className="animate-gloss" x="0" y="-20" width="32" height="140" fill={`url(#${id('sweep')})`} /> : null}
    </svg>
  );
}
