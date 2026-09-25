import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import type { ServiceArt } from '@/types/api';

/**
 * Glossy nail vectors: the app's own illustration language (no stock photos). Each service
 * picks one drawing from this collection (Admin → Services); colours come from the category's
 * swatch, so one drawing works in every colour. Pure geometry, a few hundred bytes each.
 */

const ALMOND = 'M50 6C73 6 86 33 86 68V116C86 128 77 136 65 136H35C23 136 14 128 14 116V68C14 33 27 6 50 6Z';
const STILETTO = 'M50 2C64 22 84 52 84 82V118C84 129 76 136 65 136H35C24 136 16 129 16 118V82C16 52 36 22 50 2Z';
const SQUOVAL = 'M28 40C28 30 36 24 50 24C64 24 72 30 72 40V112C72 125 63 132 50 132C37 132 28 125 28 112Z';
const WHITE = '#FFFFFF';

/** The usual fan of three nails. */
const LEFT = 'translate(8 34) rotate(-14 50 136) scale(0.82)';
const CENTER = 'translate(60 10) scale(0.92)';
const RIGHT = 'translate(118 34) rotate(14 50 136) scale(0.82)';

interface Props {
  art: ServiceArt;
  color: SwatchColor;
  className?: string;
  /** Adds the one-time gloss sweep (e.g. on the booking confirmation). */
  shine?: boolean;
}

interface NailProps {
  d: string;
  fill: string;
  transform?: string;
  /** French tip colour. */
  tip?: string;
  /** Drawn inside the nail outline (patterns). */
  decoration?: ReactNode;
  /** Drawn on top, may stick out of the outline (3D elements). */
  over?: ReactNode;
  gloss?: boolean;
}

function Nail({ d, fill, transform, tip, decoration, over, gloss = true }: NailProps) {
  const clipId = useId();
  return (
    <g transform={transform}>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={fill} />
      {tip ? <rect x="0" y="0" width="100" height="44" fill={tip} clipPath={`url(#${clipId})`} /> : null}
      {decoration ? <g clipPath={`url(#${clipId})`}>{decoration}</g> : null}
      {gloss ? (
        <>
          <path d="M31 42C31 30 36 22 42 17" stroke={WHITE} strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M30 58V92" stroke={WHITE} strokeWidth="5" strokeLinecap="round" opacity="0.45" />
        </>
      ) : null}
      {over}
    </g>
  );
}

/** A raised gel flower with a soft drop shadow: five petals and a centre bead. */
function Flower({ cx: x, cy: y, r, petal, centre }: { cx: number; cy: number; r: number; petal: string; centre: string }) {
  const petals = [0, 72, 144, 216, 288].map((angle) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: x + Math.cos(rad) * r, y: y + Math.sin(rad) * r };
  });
  return (
    <g>
      {petals.map((p, i) => (
        <circle key={`s${i}`} cx={p.x + 2} cy={p.y + 3} r={r * 0.78} fill="#252726" opacity="0.14" />
      ))}
      {petals.map((p, i) => (
        <circle key={`p${i}`} cx={p.x} cy={p.y} r={r * 0.78} fill={petal} />
      ))}
      {petals.map((p, i) => (
        <circle key={`h${i}`} cx={p.x - r * 0.25} cy={p.y - r * 0.25} r={r * 0.22} fill={WHITE} opacity="0.8" />
      ))}
      <circle cx={x} cy={y} r={r * 0.55} fill={centre} />
      <circle cx={x - r * 0.18} cy={y - r * 0.2} r={r * 0.16} fill={WHITE} opacity="0.85" />
    </g>
  );
}

function Pearl({ cx: x, cy: y, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  return (
    <g>
      <circle cx={x + 1.5} cy={y + 2} r={r} fill="#252726" opacity="0.14" />
      <circle cx={x} cy={y} r={r} fill={fill} />
      <circle cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.3} fill={WHITE} opacity="0.85" />
    </g>
  );
}

function Gem({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  const s = size;
  return (
    <g>
      <path d={`M${x} ${y - s}L${x + s * 0.8} ${y}L${x} ${y + s}L${x - s * 0.8} ${y}Z`} fill={fill} />
      <path d={`M${x} ${y - s}L${x} ${y + s}M${x - s * 0.8} ${y}H${x + s * 0.8}`} stroke={WHITE} strokeWidth="1.5" opacity="0.7" />
      <path d={`M${x - s * 0.8} ${y}L${x} ${y - s}L${x + s * 0.3} ${y - s * 0.5}Z`} fill={WHITE} opacity="0.55" />
    </g>
  );
}

// Fixed positions, so glitter looks the same on every render.
const GLITTER: Array<[number, number, number]> = [
  [30, 30, 3], [58, 22, 2.2], [44, 48, 2.6], [70, 44, 3.2], [24, 66, 2.4], [54, 70, 3], [76, 78, 2.2], [36, 90, 3.2],
  [62, 96, 2.4], [28, 112, 2.6], [50, 118, 3], [72, 112, 2.4], [46, 32, 1.6], [66, 60, 1.8], [38, 76, 1.6], [58, 132, 2],
];

/** Tip height for each size in the 220×160 box: size 1 is short, size 6 reaches the top. */
const LEVEL_Y = [0, 96, 80, 64, 48, 32, 16];
const CUTICLE_Y = 150;

/**
 * Sizes as lengths: one nail reaching size N, dotted guide lines for sizes 1 to 6 (the chosen
 * one drawn in the swatch colour), and for refills a pale regrowth band at the cuticle, the
 * part a correction fills in.
 */
function LengthNail({ level, refill, color, fill }: { level: number; refill: boolean; color: SwatchColor; fill: string }) {
  const swatch = SWATCH[color].hex;
  const tip = LEVEL_Y[level] ?? LEVEL_Y[1]!;
  const nail = `M76 ${CUTICLE_Y}V${tip + 34}C76 ${tip + 14} 92 ${tip} 110 ${tip}C128 ${tip} 144 ${tip + 14} 144 ${tip + 34}V${CUTICLE_Y}Z`;
  return (
    <>
      {LEVEL_Y.slice(1).map((y, index) => {
        const current = index + 1 === level;
        return (
          <line
            key={y}
            x1={current ? 40 : 50}
            x2={current ? 180 : 170}
            y1={y}
            y2={y}
            stroke={current ? swatch.accent : '#CBCDCC'}
            strokeWidth={current ? 4 : 3}
            strokeDasharray={current ? '9 7' : '2 8'}
            strokeLinecap="round"
          />
        );
      })}
      <path d={nail} fill={fill} />
      {/* The natural nail under the product. */}
      <path d={`M84 ${CUTICLE_Y}V120C84 113 95 108 110 108C125 108 136 113 136 120V${CUTICLE_Y}Z`} fill={WHITE} opacity="0.28" />
      {refill ? <rect x="76" y={CUTICLE_Y - 16} width="68" height="16" fill={WHITE} opacity="0.78" /> : null}
      <path d={`M92 ${tip + 38}C92 ${tip + 26} 97 ${tip + 17} 104 ${tip + 11}`} stroke={WHITE} strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.7" />
    </>
  );
}

export function NailArt({ art, color, className, shine }: Props) {
  const gradientId = useId();
  const ombreId = useId();
  const chromeId = useId();
  const sweepId = useId();
  const swatch = SWATCH[color].hex;
  const fill = `url(#${gradientId})`;

  const length = /^(length|refill)-([1-6])$/.exec(art);
  const nails = (() => {
    if (length) return <LengthNail level={Number(length[2])} refill={length[1] === 'refill'} color={color} fill={fill} />;
    switch (art) {
      case 'french':
        return [LEFT, CENTER, RIGHT].map((t) => <Nail key={t} d={ALMOND} fill={fill} tip={WHITE} transform={t} />);
      case 'ombre':
        return [LEFT, CENTER, RIGHT].map((t) => <Nail key={t} d={ALMOND} fill={`url(#${ombreId})`} transform={t} />);
      case 'chrome':
        return [LEFT, CENTER, RIGHT].map((t) => (
          <Nail
            key={t}
            d={ALMOND}
            fill={`url(#${chromeId})`}
            transform={t}
            decoration={<path d="M58 14C70 34 74 70 70 118" stroke={WHITE} strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.55" />}
          />
        ));
      case 'glitter':
        return [LEFT, CENTER, RIGHT].map((t, n) => (
          <Nail
            key={t}
            d={ALMOND}
            fill={fill}
            transform={t}
            decoration={GLITTER.map(([x, y, r], i) => (
              <circle key={i} cx={(x + n * 7) % 90} cy={y} r={r} fill={i % 3 === 0 ? swatch.field : WHITE} opacity={i % 2 ? 0.95 : 0.75} />
            ))}
          />
        ));
      case 'extension':
        return [
          <Nail key="1" d={STILETTO} fill={fill} transform="translate(6 30) rotate(-16 50 136) scale(0.84)" />,
          <Nail key="2" d={STILETTO} fill={fill} transform="translate(60 2) scale(0.95)" />,
          <Nail key="3" d={STILETTO} fill={fill} transform="translate(120 30) rotate(16 50 136) scale(0.84)" />,
        ];
      case 'pedicure':
        return [
          <Nail key="1" d={SQUOVAL} fill={fill} transform="translate(18 46) scale(0.8)" />,
          <Nail key="2" d={SQUOVAL} fill={fill} transform="translate(62 22) scale(0.98)" />,
          <Nail key="3" d={SQUOVAL} fill={fill} transform="translate(116 52) scale(0.74)" />,
        ];
      case 'design':
        // A simple accent: plain nail and a contrasting one, with a couple of sparkles.
        return [
          <Nail key="1" d={ALMOND} fill={fill} transform="translate(22 30) rotate(-10 50 136) scale(0.86)" />,
          <Nail key="2" d={ALMOND} fill={swatch.deep} transform="translate(92 22) rotate(10 50 136) scale(0.86)" />,
          <path key="s1" d="M150 34l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill={swatch.accent} />,
          <path key="s2" d="M30 30l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={swatch.deep} />,
          <circle key="d1" cx="176" cy="92" r="5" fill={swatch.accent} />,
        ];
      case 'design-complex': {
        // Hand-drawn marble swirls running through two nails.
        const swirls = (
          <>
            <path d="M-6 52C22 30 44 70 70 48S104 40 110 30" stroke={WHITE} strokeWidth="7" fill="none" strokeLinecap="round" />
            <path d="M-6 86C20 70 40 104 66 88S100 76 108 70" stroke={swatch.deep} strokeWidth="5" fill="none" strokeLinecap="round" />
            <path d="M-4 112C18 102 36 126 58 116S92 104 104 108" stroke={WHITE} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.85" />
            <path d="M10 20C30 26 42 12 60 18" stroke={swatch.deep} strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        );
        return [
          <Nail key="1" d={ALMOND} fill={fill} transform="translate(26 28) rotate(-9 50 136) scale(0.88)" decoration={swirls} />,
          <Nail key="2" d={ALMOND} fill={fill} transform="translate(98 22) rotate(9 50 136) scale(0.88)" decoration={swirls} />,
        ];
      }
      case 'design-3d':
        // One statement nail with a raised gel flower, a second with 3D pearls.
        return [
          <Nail
            key="1"
            d={ALMOND}
            fill={fill}
            transform="translate(34 12) rotate(-6 50 136) scale(0.96)"
            over={<Flower cx={50} cy={64} r={15} petal={WHITE} centre={swatch.accent} />}
          />,
          <Nail
            key="2"
            d={ALMOND}
            fill={swatch.deep}
            transform="translate(122 40) rotate(12 50 136) scale(0.74)"
            over={
              <>
                <Pearl cx={50} cy={46} r={8} fill={WHITE} />
                <Pearl cx={38} cy={70} r={6} fill={swatch.field} />
                <Pearl cx={60} cy={86} r={7} fill={WHITE} />
              </>
            }
          />,
        ];
      case 'design-extra':
        // A full set where every nail is different: stripes, a gel flower, dots and a star.
        return [
          <Nail
            key="1"
            d={ALMOND}
            fill={fill}
            transform="translate(8 44) rotate(-16 50 136) scale(0.66)"
            decoration={[20, 44, 68, 92, 116].map((y) => (
              <path key={y} d={`M-10 ${y + 14}L110 ${y - 14}`} stroke={WHITE} strokeWidth="6" opacity="0.85" />
            ))}
          />,
          <Nail
            key="2"
            d={ALMOND}
            fill={swatch.deep}
            transform="translate(44 18) rotate(-6 50 136) scale(0.76)"
            over={<Flower cx={50} cy={60} r={12} petal={swatch.field} centre={WHITE} />}
          />,
          <Nail
            key="3"
            d={ALMOND}
            fill={fill}
            transform="translate(92 18) rotate(6 50 136) scale(0.76)"
            decoration={[
              [28, 34], [58, 30], [44, 56], [72, 58], [26, 80], [56, 84], [40, 108], [70, 108],
            ].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill={WHITE} opacity="0.9" />)}
          />,
          <Nail
            key="4"
            d={ALMOND}
            fill={WHITE}
            transform="translate(138 42) rotate(16 50 136) scale(0.66)"
            decoration={<path d="M50 40l8 18 20 3-15 13 4 20-17-10-17 10 4-20-15-13 20-3z" fill={swatch.accent} />}
          />,
        ];
      case 'crystals':
        return [
          <Nail
            key="1"
            d={ALMOND}
            fill={fill}
            transform="translate(26 26) rotate(-8 50 136) scale(0.9)"
            over={
              <>
                <Gem x={50} y={104} size={11} fill={WHITE} />
                <Gem x={34} y={116} size={7} fill={swatch.field} />
                <Gem x={66} y={116} size={7} fill={swatch.field} />
                <Gem x={50} y={84} size={6} fill={WHITE} />
              </>
            }
          />,
          <Nail
            key="2"
            d={ALMOND}
            fill={swatch.deep}
            transform="translate(104 22) rotate(8 50 136) scale(0.9)"
            over={
              <>
                <Gem x={50} y={50} size={9} fill={WHITE} />
                <Gem x={50} y={78} size={6} fill={swatch.field} />
                <Gem x={50} y={100} size={4} fill={WHITE} />
              </>
            }
          />,
        ];
      case 'removal':
        return [
          <Nail key="1" d={ALMOND} fill={fill} transform="translate(30 22) rotate(-8 50 136) scale(0.9)" />,
          <g key="2" transform="translate(98 26) rotate(8 50 136) scale(0.9)">
            <path d={ALMOND} fill={WHITE} stroke={swatch.accent} strokeWidth="4" strokeDasharray="8 8" />
          </g>,
        ];
      case 'file':
        // A nail and a file: taking off product another salon applied.
        return [
          <Nail key="1" d={ALMOND} fill={fill} transform="translate(22 22) rotate(-6 50 136) scale(0.92)" />,
          <g key="file" transform="rotate(-26 152 84)">
            <rect x="138" y="8" width="28" height="136" rx="14" fill={swatch.deep} />
            <rect x="141" y="11" width="22" height="92" rx="11" fill={swatch.accent} />
            {[20, 32, 44, 56, 68, 80, 92].flatMap((y) =>
              [147, 157].map((x) => <circle key={`${x}-${y}`} cx={x + ((y / 12) % 2) * 2} cy={y} r="1.8" fill={WHITE} opacity="0.75" />),
            )}
            <path d="M145 118h14M145 126h14" stroke={WHITE} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          </g>,
        ];
      case 'care':
        return [
          <Nail key="1" d={ALMOND} fill={fill} transform="translate(40 24) scale(0.92)" />,
          <path key="drop" d="M150 40C150 40 132 64 132 78C132 88 140 96 150 96C160 96 168 88 168 78C168 64 150 40 150 40Z" fill={swatch.accent} />,
          <path key="dropGloss" d="M143 72C143 67 146 62 149 58" stroke={WHITE} strokeWidth="4" strokeLinecap="round" opacity="0.8" />,
        ];
      case 'gel':
      default:
        return [LEFT, CENTER, RIGHT].map((t) => <Nail key={t} d={ALMOND} fill={fill} transform={t} />);
    }
  })();

  return (
    <svg viewBox={length ? '34 6 152 152' : '0 0 220 160'} className={cx('block', className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={swatch.accent} stopOpacity="0.78" />
          <stop offset="1" stopColor={swatch.deep} />
        </linearGradient>
        <linearGradient id={ombreId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={WHITE} />
          <stop offset="0.45" stopColor={swatch.accent} stopOpacity="0.8" />
          <stop offset="1" stopColor={swatch.deep} />
        </linearGradient>
        <linearGradient id={chromeId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={swatch.deep} />
          <stop offset="0.3" stopColor={WHITE} />
          <stop offset="0.55" stopColor={swatch.accent} />
          <stop offset="0.8" stopColor={swatch.deep} />
          <stop offset="1" stopColor={swatch.accent} />
        </linearGradient>
        <linearGradient id={sweepId} x1="0" x2="1">
          <stop offset="0" stopColor={WHITE} stopOpacity="0" />
          <stop offset="0.5" stopColor={WHITE} stopOpacity="0.55" />
          <stop offset="1" stopColor={WHITE} stopOpacity="0" />
        </linearGradient>
      </defs>
      {nails}
      {shine ? <rect className="animate-gloss" x="0" y="-20" width="70" height="200" fill={`url(#${sweepId})`} /> : null}
    </svg>
  );
}
