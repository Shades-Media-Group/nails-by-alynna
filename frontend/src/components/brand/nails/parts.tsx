import { useId, type ReactNode } from 'react';
import {
  cuticlePath,
  d,
  fingerPath,
  folds,
  glossPath,
  nailPath,
  smileTipPath,
  toePath,
  type NailGeometry,
  type NailShape,
} from './geometry';
import { INK, NATURAL, SKIN, STEEL, WHITE, mix, usePaint } from './paint';

/** Fingers run on past the bottom of the box, so the tile's edge crops them. */
const CROP_Y = 112;

export interface DigitProps {
  /** Centre of the fingertip end, in the art box. */
  x: number;
  y: number;
  /** Tilt in degrees (positive leans the tip right). */
  angle?: number;
  /** Finger width. */
  w: number;
  /** How far the nail runs past the fingertip, in finger widths (0 = level with it). */
  ext: number;
  shape?: NailShape;
  /** Polish fill; the swatch polish by default. */
  fill?: string;
  /** Shading over the nail: tinted for coloured polish, warm neutral for bare or pale nails. */
  dome?: 'color' | 'nude';
  /** A bare natural nail: pink bed, pale half-moon, white free edge. */
  natural?: boolean;
  /** Refill: grown-out natural nail between the cuticle and the old polish, in nail widths. */
  regrowth?: number;
  /** Drawn inside the nail outline. */
  decoration?: (g: NailGeometry) => ReactNode;
  /** Drawn over the nail and allowed past its edge (3D work, stones). */
  over?: (g: NailGeometry) => ReactNode;
  /** A toe instead of a finger: broader outline, no knuckle creases. */
  toe?: boolean;
  /** Casts a soft shadow on what is behind it. */
  front?: boolean;
  /** Nail proportions, when they differ from a finger's. */
  nail?: Partial<Pick<NailGeometry, 'nw' | 'yc'>>;
}

/** Faint wrinkles over the last knuckle. */
function Creases({ w, y }: { w: number; y: number }) {
  return (
    <path
      d={d`M${-0.18 * w} ${y}Q0 ${y + 0.06 * w} ${0.18 * w} ${y}M${-0.11 * w} ${y + 0.09 * w}Q0 ${y + 0.13 * w} ${0.11 * w} ${y + 0.09 * w}`}
      stroke={SKIN.crease}
      strokeOpacity="0.3"
      strokeWidth="0.7"
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** Pink nail bed, the pale half-moon at the base, and the lighter free edge past the fingertip. */
function NaturalNail({ g, w, moon }: { g: NailGeometry; w: number; moon: boolean }) {
  const paint = usePaint();
  return (
    <>
      <path d={nailPath(g)} fill={paint.url('natural')} />
      {moon ? <ellipse cx="0" cy={g.yc - 0.02 * g.nw} rx={g.nw * 0.3} ry={g.nw * 0.2} fill={NATURAL.moon} opacity="0.75" /> : null}
      <path d={smileTipPath(g, 0.02 * w, 0.2 * w)} fill={NATURAL.edge} />
    </>
  );
}

/**
 * One finger (or toe) with its nail, as a close-up: skin with a hairline edge, the nail tucked
 * into its folds (cuticle and sides), a visible free edge, one soft highlight.
 */
export function Digit({
  x,
  y,
  angle = 0,
  w,
  ext,
  shape = 'almond',
  fill,
  dome = 'color',
  natural,
  regrowth,
  decoration,
  over,
  toe,
  front,
  nail: proportions,
}: DigitProps) {
  const paint = usePaint();
  const uid = useId();
  const clipId = `${uid}clip`;
  const skinId = `${uid}skin`;
  const g: NailGeometry = { nw: proportions?.nw ?? 0.74 * w, yc: proportions?.yc ?? 0.86 * w, yt: -ext * w, shape };
  const len = (CROP_Y - y) / Math.cos((angle * Math.PI) / 180) + 0.3 * w;
  const outline = toe ? toePath(w, len) : fingerPath(w, len);
  const nail = nailPath(g);
  const fold = folds(g, 0.5 * g.nw);
  const skin = `url(#${skinId})`;
  const clip = `url(#${clipId})`;
  const polish = fill ?? paint.url('polish');
  const grown = regrowth ? { ...g, yc: g.yc - regrowth * g.nw } : null;

  return (
    <g transform={d`translate(${x} ${y}) rotate(${angle})`}>
      <defs>
        {/* Two-stop skin, lit from the left, in this finger's own units so the folds match it. */}
        <linearGradient id={skinId} gradientUnits="userSpaceOnUse" x1={-0.3 * w} y1="0" x2={0.55 * w} y2="0">
          <stop offset="0" stopColor={SKIN.light} />
          <stop offset="1" stopColor={SKIN.shade} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={nail} />
        </clipPath>
      </defs>
      {front ? <path d={outline} transform="translate(1.8 1.2)" fill={INK} opacity="0.12" /> : null}
      <path d={outline} fill={skin} stroke={SKIN.edge} strokeOpacity="0.55" strokeWidth="0.7" />
      {toe ? null : <Creases w={w} y={g.yc + 0.52 * w} />}
      {/* The nail's own thickness: a soft step onto the skin and the field. */}
      <path d={nail} transform="translate(0.5 1)" fill={INK} opacity="0.12" />
      {natural || grown ? (
        <g clipPath={clip}>
          <NaturalNail g={g} w={w} moon={!grown} />
          {grown ? (
            <>
              <path d={nailPath(grown)} fill={polish} />
              {/* The edge of the old polish: a small step down to the new growth, lit on top. */}
              <path d={cuticlePath(grown, 0.9)} stroke={INK} strokeOpacity="0.22" strokeWidth="1" fill="none" />
              <path d={cuticlePath(grown, -0.1)} stroke={WHITE} strokeOpacity="0.65" strokeWidth="0.8" fill="none" />
            </>
          ) : null}
        </g>
      ) : (
        <path d={nail} fill={polish} />
      )}
      {decoration ? <g clipPath={clip}>{decoration(g)}</g> : null}
      <path d={nail} fill={paint.url(dome === 'nude' || natural ? 'domeNude' : 'dome')} />
      <path d={glossPath(g)} fill={paint.url('gloss')} />
      {/* The folds: a thin shadow line on the nail, then the skin lapping over its edges. */}
      <g clipPath={clip} stroke={INK} strokeOpacity="0.2" fill="none" strokeLinecap="round">
        <path d={fold.arc} strokeWidth="3.4" />
        <path d={fold.leftEdge} strokeWidth="1.4" />
        <path d={fold.rightEdge} strokeWidth="1.4" />
      </g>
      <path d={fold.arc} stroke={skin} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d={fold.left} fill={skin} />
      <path d={fold.right} fill={skin} />
      <path d={cuticlePath(g, 1.4)} stroke={SKIN.light} strokeOpacity="0.9" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      {over ? over(g) : null}
    </g>
  );
}

// ── Decorations ────────────────────────────────────────────────────────────────────────────

/** Four-pointed sparkle. */
export function Sparkle({ x, y, s, fill = WHITE, opacity = 1 }: { x: number; y: number; s: number; fill?: string; opacity?: number }) {
  const k = s * 0.14;
  return (
    <path
      d={d`M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z`}
      fill={fill}
      opacity={opacity}
    />
  );
}

/** A rhinestone: a cut stone with a dark rim, a bright table facet and a star glint. */
export function Crystal({ x, y, r }: { x: number; y: number; r: number }) {
  const paint = usePaint();
  const t = r * 0.52;
  return (
    <g>
      <circle cx={x + 0.3 * r} cy={y + 0.45 * r} r={r} fill={INK} opacity="0.28" />
      <circle cx={x} cy={y} r={r} fill={`url(#${paint.id('crystal')})`} />
      <path
        d={d`M${x - t} ${y}L${x - t * 0.7} ${y - t * 0.7}L${x} ${y - t}L${x + t * 0.7} ${y - t * 0.7}L${x + t} ${y}L${x + t * 0.7} ${y + t * 0.7}L${x} ${y + t}L${x - t * 0.7} ${y + t * 0.7}Z`}
        fill={WHITE}
        fillOpacity="0.4"
        stroke={WHITE}
        strokeOpacity="0.85"
        strokeWidth={r * 0.09}
      />
      <Sparkle x={x - r * 0.3} y={y - r * 0.32} s={r * 0.62} />
    </g>
  );
}

/** Crystal gradient: bright at the heart, the swatch colour deepening to a dark rim. */
export function CrystalDefs() {
  const paint = usePaint();
  return (
    <radialGradient id={paint.id('crystal')} cx="0.42" cy="0.38" r="0.66">
      <stop offset="0" stopColor={WHITE} />
      <stop offset="0.3" stopColor={mix(paint.tint, WHITE, 0.5)} />
      <stop offset="0.72" stopColor={paint.accent} />
      <stop offset="1" stopColor={paint.deep} />
    </radialGradient>
  );
}

/** A pearl bead with its shadow. */
export function Pearl({ x, y, r }: { x: number; y: number; r: number }) {
  const paint = usePaint();
  return (
    <g>
      <circle cx={x + 0.3 * r} cy={y + 0.45 * r} r={r} fill={INK} opacity="0.22" />
      <circle cx={x} cy={y} r={r} fill={`url(#${paint.id('pearl')})`} />
      <circle cx={x - r * 0.32} cy={y - r * 0.34} r={r * 0.28} fill={WHITE} />
    </g>
  );
}

export function PearlDefs() {
  const paint = usePaint();
  return (
    <radialGradient id={paint.id('pearl')} cx="0.4" cy="0.36" r="0.68">
      <stop offset="0" stopColor={WHITE} />
      <stop offset="0.7" stopColor="#F3ECE9" />
      <stop offset="1" stopColor="#D5C7C2" />
    </radialGradient>
  );
}

/** A sculpted gel flower standing off the nail: shaded petals with shadows, a pearl centre. */
export function GelFlower({ x, y, r, petal }: { x: number; y: number; r: number; petal: string }) {
  const angles = [0, 72, 144, 216, 288];
  return (
    <g>
      {angles.map((angle) => (
        <ellipse
          key={`s${angle}`}
          cx={x + r * 0.06}
          cy={y - r * 0.55 + r * 0.1}
          rx={r * 0.44}
          ry={r * 0.58}
          transform={d`rotate(${angle} ${x} ${y})`}
          fill={INK}
          opacity="0.2"
        />
      ))}
      {angles.map((angle) => (
        <ellipse key={`p${angle}`} cx={x} cy={y - r * 0.55} rx={r * 0.44} ry={r * 0.58} transform={d`rotate(${angle} ${x} ${y})`} fill={petal} />
      ))}
      {angles.map((angle) => (
        <ellipse
          key={`h${angle}`}
          cx={x - r * 0.08}
          cy={y - r * 0.74}
          rx={r * 0.13}
          ry={r * 0.22}
          transform={d`rotate(${angle} ${x} ${y})`}
          fill={WHITE}
          opacity="0.85"
        />
      ))}
      <Pearl x={x} y={y} r={r * 0.34} />
    </g>
  );
}

/** Petal gradient: lit at the top left, deepening toward the rim. */
export function PetalDefs({ from, to }: { from: string; to: string }) {
  const paint = usePaint();
  return (
    <radialGradient id={paint.id('petal')} cx="0.4" cy="0.35" r="0.75">
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </radialGradient>
  );
}

/** A flat painted flower: five dots round a centre dot. */
export function DotFlower({ x, y, r, fill, centre }: { x: number; y: number; r: number; fill: string; centre: string }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((angle) => {
        const rad = ((angle - 90) * Math.PI) / 180;
        return <circle key={angle} cx={x + Math.cos(rad) * r} cy={y + Math.sin(rad) * r} r={r * 0.62} fill={fill} />;
      })}
      <circle cx={x} cy={y} r={r * 0.5} fill={centre} />
    </g>
  );
}

// Glitter flakes in nail coordinates: u across the nail (−0.5…0.5), v from the tip (0) to the
// cuticle (1), radius in nail widths, tone 0 white / 1 tint. Denser toward the tip.
const GLITTER: Array<[number, number, number, number]> = [
  [-0.22, 0.07, 0.07, 0], [0.12, 0.09, 0.05, 1], [0.02, 0.17, 0.08, 0], [-0.3, 0.2, 0.05, 1], [0.28, 0.19, 0.06, 0],
  [-0.1, 0.27, 0.05, 1], [0.18, 0.31, 0.07, 0], [-0.26, 0.36, 0.06, 0], [0.04, 0.38, 0.05, 1], [0.3, 0.42, 0.04, 1],
  [-0.12, 0.47, 0.06, 0], [0.16, 0.53, 0.045, 0], [-0.3, 0.57, 0.04, 1], [0.02, 0.62, 0.05, 0], [0.26, 0.66, 0.04, 1],
  [-0.16, 0.72, 0.04, 0], [0.1, 0.78, 0.035, 1], [-0.04, 0.86, 0.035, 0], [0.32, 0.06, 0.05, 1], [-0.38, 0.11, 0.04, 0],
  [0.1, 0.24, 0.03, 0], [-0.18, 0.14, 0.03, 1], [0.22, 0.12, 0.03, 0], [-0.05, 0.33, 0.03, 0],
];

export function Glitter({ g }: { g: NailGeometry }) {
  const paint = usePaint();
  const tones = [WHITE, mix(paint.tint, WHITE, 0.3)];
  const length = g.yc - g.yt;
  return (
    <>
      {GLITTER.map(([u, v, r, tone], i) => (
        <circle key={i} cx={u * g.nw} cy={g.yt + v * length} r={r * g.nw} fill={tones[tone]} opacity={tone === 0 ? 0.95 : 0.85} />
      ))}
    </>
  );
}

/** A tip above a smile line (French), in `fill`; the smile sits where the fingertip ends. */
export function SmileTip({ g, fill = WHITE }: { g: NailGeometry; fill?: string }) {
  return <path d={smileTipPath(g, -0.02 * g.nw, 0.42 * g.nw)} fill={fill} />;
}

// ── Tools ──────────────────────────────────────────────────────────────────────────────────

/** A nail file: an abrasive face over a white core. Centred on (x, y). */
export function NailFile({ x, y, angle, length, width }: { x: number; y: number; angle: number; length: number; width: number }) {
  const paint = usePaint();
  const half = length / 2;
  const grains: Array<[number, number]> = [];
  for (let i = 0; i < 24; i += 1) grains.push([-half + 4 + ((i * 37) % 97) * ((length - 8) / 97), (((i * 53) % 29) / 29 - 0.5) * (width - 4)]);
  return (
    <g transform={d`translate(${x} ${y}) rotate(${angle})`}>
      <rect x={-half + 1.2} y={-width / 2 + 1.8} width={length} height={width} rx={width / 2} fill={INK} opacity="0.16" />
      <rect x={-half} y={-width / 2} width={length} height={width} rx={width / 2} fill={WHITE} />
      <rect x={-half + 1.2} y={-width / 2 + 1.2} width={length - 2.4} height={width - 2.4} rx={width / 2 - 1.2} fill={paint.deep} />
      {grains.map(([gx, gy], i) => (
        <circle key={i} cx={gx} cy={gy} r={i % 3 === 0 ? 0.85 : 0.55} fill={paint.tint} opacity="0.75" />
      ))}
      <rect x={-half + 4} y={-width / 2 + 2} width={length - 8} height="1.1" rx="0.55" fill={WHITE} opacity="0.35" />
    </g>
  );
}

/** A cotton pad with remover, stained where it has wiped the polish off. */
export function CottonPad({ x, y, r }: { x: number; y: number; r: number }) {
  const paint = usePaint();
  const dimples: Array<[number, number]> = [
    [-0.1, -0.5], [0.35, -0.38], [0.55, 0.02], [0.1, -0.1], [0.4, 0.4], [-0.05, 0.3], [0.1, 0.62], [-0.35, 0.55],
  ];
  return (
    <g>
      <circle cx={x + 1.4} cy={y + 2} r={r} fill={INK} opacity="0.14" />
      <circle cx={x} cy={y} r={r} fill={`url(#${paint.id('cotton')})`} />
      {dimples.map(([u, v]) => (
        <circle key={`${u}${v}`} cx={x + u * r} cy={y + v * r} r={r * 0.055} fill="#E0D6D2" />
      ))}
      <path
        d={d`M${x - r * 0.96} ${y + r * 0.05}C${x - r * 0.92} ${y - r * 0.5} ${x - r * 0.5} ${y - r * 0.62} ${x - r * 0.36} ${y - r * 0.28}C${x - r * 0.24} ${y + r * 0.02} ${x - r * 0.52} ${y + r * 0.2} ${x - r * 0.46} ${y + r * 0.5}C${x - r * 0.42} ${y + r * 0.78} ${x - r * 0.84} ${y + r * 0.62} ${x - r * 0.96} ${y + r * 0.05}Z`}
        fill={paint.accent}
        opacity="0.6"
      />
    </g>
  );
}

export function CottonDefs() {
  const paint = usePaint();
  return (
    <radialGradient id={paint.id('cotton')} cx="0.42" cy="0.38" r="0.66">
      <stop offset="0" stopColor={WHITE} />
      <stop offset="0.75" stopColor="#FBF8F7" />
      <stop offset="1" stopColor="#E6DDDA" />
    </radialGradient>
  );
}

/** A steel cuticle pusher: flat rounded spoon at (x, y), thin neck, knurled handle. */
export function Pusher({ x, y, angle }: { x: number; y: number; angle: number }) {
  const paint = usePaint();
  const steel = `url(#${paint.id('steel')})`;
  return (
    <g transform={d`translate(${x} ${y}) rotate(${angle})`}>
      <path d="M1 -3.4H62a3.4 3.4 0 0 1 0 6.8H1Z" fill={INK} opacity="0.14" transform="translate(0.6 1.8)" />
      <path d="M-0.6 -3.4C2.6 -3.6 5.4 -2 6.4 -1.1L18 -1.3V1.3L6.4 1.1C5.4 2 2.6 3.6 -0.6 3.4C-2.2 2 -2.2 -2 -0.6 -3.4Z" fill={steel} />
      <rect x="17" y="-3.3" width="46" height="6.6" rx="3.3" fill={steel} />
      {[23, 26, 29, 32, 35, 38].map((gx) => (
        <path key={gx} d={`M${gx} -2.8V2.8`} stroke={STEEL.dark} strokeOpacity="0.55" strokeWidth="0.7" />
      ))}
      <rect x="52" y="-3.3" width="2.4" height="6.6" fill={paint.accent} />
    </g>
  );
}

export function ToolDefs() {
  const paint = usePaint();
  return (
    <linearGradient id={paint.id('steel')} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={STEEL.light} />
      <stop offset="0.45" stopColor={STEEL.base} />
      <stop offset="1" stopColor={STEEL.dark} />
    </linearGradient>
  );
}
