import { useId } from 'react';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import type { ServiceArt } from '@/types/api';

/**
 * Glossy almond-nail vectors — the app's own illustration language (no stock photos).
 * Pure geometry: each service type is a small arrangement of nail shapes in the category's
 * swatch colour with one highlight stroke, the "fresh coat" gloss.
 */

const ALMOND = 'M50 6C73 6 86 33 86 68V116C86 128 77 136 65 136H35C23 136 14 128 14 116V68C14 33 27 6 50 6Z';
const STILETTO = 'M50 2C64 22 84 52 84 82V118C84 129 76 136 65 136H35C24 136 16 129 16 118V82C16 52 36 22 50 2Z';
const SQUOVAL = 'M28 40C28 30 36 24 50 24C64 24 72 30 72 40V112C72 125 63 132 50 132C37 132 28 125 28 112Z';

interface Props {
  art: ServiceArt;
  color: SwatchColor;
  className?: string;
  /** Adds the one-time gloss sweep (e.g. on the booking confirmation). */
  shine?: boolean;
}

function Nail({ d, fill, gloss, transform, tip }: { d: string; fill: string; gloss: string; transform?: string; tip?: string }) {
  const clipId = useId();
  return (
    <g transform={transform}>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={fill} />
      {tip ? <rect x="0" y="0" width="100" height="44" fill={tip} clipPath={`url(#${clipId})`} /> : null}
      <path d="M31 42C31 30 36 22 42 17" stroke={gloss} strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M30 58V92" stroke={gloss} strokeWidth="5" strokeLinecap="round" opacity="0.45" />
    </g>
  );
}

export function NailArt({ art, color, className, shine }: Props) {
  const gradientId = useId();
  const sweepId = useId();
  const swatch = SWATCH[color].hex;
  const fill = `url(#${gradientId})`;
  const white = '#FFFFFF';

  const nails = (() => {
    switch (art) {
      case 'french':
        return [
          <Nail key="1" d={ALMOND} fill={fill} gloss={white} tip={white} transform="translate(8 34) rotate(-14 50 136) scale(0.82)" />,
          <Nail key="2" d={ALMOND} fill={fill} gloss={white} tip={white} transform="translate(60 10) scale(0.92)" />,
          <Nail key="3" d={ALMOND} fill={fill} gloss={white} tip={white} transform="translate(118 34) rotate(14 50 136) scale(0.82)" />,
        ];
      case 'extension':
        return [
          <Nail key="1" d={STILETTO} fill={fill} gloss={white} transform="translate(6 30) rotate(-16 50 136) scale(0.84)" />,
          <Nail key="2" d={STILETTO} fill={fill} gloss={white} transform="translate(60 2) scale(0.95)" />,
          <Nail key="3" d={STILETTO} fill={fill} gloss={white} transform="translate(120 30) rotate(16 50 136) scale(0.84)" />,
        ];
      case 'pedicure':
        return [
          <Nail key="1" d={SQUOVAL} fill={fill} gloss={white} transform="translate(18 46) scale(0.8)" />,
          <Nail key="2" d={SQUOVAL} fill={fill} gloss={white} transform="translate(62 22) scale(0.98)" />,
          <Nail key="3" d={SQUOVAL} fill={fill} gloss={white} transform="translate(116 52) scale(0.74)" />,
        ];
      case 'design':
        return [
          <Nail key="1" d={ALMOND} fill={fill} gloss={white} transform="translate(22 30) rotate(-10 50 136) scale(0.86)" />,
          <Nail key="2" d={ALMOND} fill={swatch.deep} gloss={white} transform="translate(92 22) rotate(10 50 136) scale(0.86)" />,
          <path key="s1" d="M150 34l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill={swatch.accent} />,
          <path key="s2" d="M30 30l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={swatch.deep} />,
          <circle key="d1" cx="176" cy="92" r="5" fill={swatch.accent} />,
        ];
      case 'removal':
        return [
          <Nail key="1" d={ALMOND} fill={fill} gloss={white} transform="translate(30 22) rotate(-8 50 136) scale(0.9)" />,
          <g key="2" transform="translate(98 26) rotate(8 50 136) scale(0.9)">
            <path d={ALMOND} fill={white} stroke={swatch.accent} strokeWidth="4" strokeDasharray="8 8" />
          </g>,
        ];
      case 'care':
        return [
          <Nail key="1" d={ALMOND} fill={fill} gloss={white} transform="translate(40 24) scale(0.92)" />,
          <path key="drop" d="M150 40C150 40 132 64 132 78C132 88 140 96 150 96C160 96 168 88 168 78C168 64 150 40 150 40Z" fill={swatch.accent} />,
          <path key="dropGloss" d="M143 72C143 67 146 62 149 58" stroke={white} strokeWidth="4" strokeLinecap="round" opacity="0.8" />,
        ];
      case 'gel':
      default:
        return [
          <Nail key="1" d={ALMOND} fill={fill} gloss={white} transform="translate(8 34) rotate(-14 50 136) scale(0.82)" />,
          <Nail key="2" d={ALMOND} fill={fill} gloss={white} transform="translate(60 10) scale(0.92)" />,
          <Nail key="3" d={ALMOND} fill={fill} gloss={white} transform="translate(118 34) rotate(14 50 136) scale(0.82)" />,
        ];
    }
  })();

  return (
    <svg viewBox="0 0 220 160" className={cx('block', className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={swatch.accent} stopOpacity="0.78" />
          <stop offset="1" stopColor={swatch.deep} />
        </linearGradient>
        <linearGradient id={sweepId} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {nails}
      {shine ? <rect className="animate-gloss" x="0" y="-20" width="70" height="200" fill={`url(#${sweepId})`} /> : null}
    </svg>
  );
}
