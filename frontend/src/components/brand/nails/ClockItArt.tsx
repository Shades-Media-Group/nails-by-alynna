import { useEffect, useId } from 'react';
import { CLOCK_IT_HAND } from './clockItHand';

/**
 * "Clock it": the ballroom-slang hand sign for "noticed, yes!". A raised hand with long pink
 * nails, three fingers up, and the index and thumb nails tapping tip to tip, three times. Still
 * (nails touching) for people who switched motion off.
 *
 * The hand is Google's Noto 3D "OK hand" emoji (Apache 2.0, see src/assets/clock-it/NOTICE.md),
 * placed at 0 0 512 512. The nails are drawn here, under it: each one grows out from behind its
 * fingertip, so the finger covers the nail's base the way it does seen from the palm side.
 */

type Point = readonly [number, number];

interface NailSpec {
  /** The rounded fingertip in the picture: its centre and radius. */
  centre: Point;
  r: number;
  /** Which way the finger points. */
  dir: Point;
  /** Where the nail's point ends. */
  tip: Point;
  /** Half the nail's width at its base, as a share of the fingertip's radius. */
  width: number;
}

const unit = ([x, y]: Point): Point => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

/** A raised finger's nail: straight on from the fingertip, `length` past it. */
function raised(centre: Point, r: number, dir: Point, length: number): NailSpec {
  const [dx, dy] = unit(dir);
  return {
    centre,
    r,
    dir: [dx, dy],
    tip: [centre[0] + dx * (r + length), centre[1] + dy * (r + length)],
    width: 0.72,
  };
}

/** Where the index and thumb nails meet. */
const TOUCH: Point = [60, 280];

const NAILS = {
  middle: raised([258.4, 41.7], 24.4, [-0.52, -0.85], 68),
  ring: raised([241, 67.1], 20.5, [-0.45, -0.89], 58),
  little: raised([233, 121.9], 14.6, [-0.5, -0.87], 44),
  index: { centre: [142, 278.1], r: 20.5, dir: unit([-0.989, 0.15]), tip: TOUCH, width: 0.8 },
  thumb: { centre: [134.2, 326.2], r: 21.6, dir: unit([-0.49, -0.87]), tip: TOUCH, width: 0.8 },
} satisfies Record<string, NailSpec>;

type NailName = keyof typeof NAILS;

/** Light falls from the top left, as on the hand. */
const LIGHT = unit([-0.6, -0.8]);

const POLISH = {
  light: '#FF8DB8',
  base: '#F7327F',
  deep: '#A80E48',
  edge: '#8E0B3E',
  shade: '#5A0A2A',
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const path = (points: Point[]) => `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L')} Z`;

/**
 * The nail's centre line: a quadratic curve from the fingertip's centre to the nail's point. It
 * leaves the fingertip halfway between the finger's own line and the straight way to the point,
 * so a nail that has to reach its partner bends a little, like a long nail does.
 */
function spine({ centre, dir, tip }: NailSpec) {
  const span = Math.hypot(tip[0] - centre[0], tip[1] - centre[1]);
  const chord = unit([tip[0] - centre[0], tip[1] - centre[1]]);
  const start = unit([dir[0] + chord[0], dir[1] + chord[1]]);
  const control: Point = [centre[0] + start[0] * span * 0.35, centre[1] + start[1] * span * 0.35];
  const at = (t: number): Point => {
    const a = (1 - t) ** 2;
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [
      a * centre[0] + b * control[0] + c * tip[0],
      a * centre[1] + b * control[1] + c * tip[1],
    ];
  };
  const tangent = (t: number): Point =>
    unit([
      2 * (1 - t) * (control[0] - centre[0]) + 2 * t * (tip[0] - control[0]),
      2 * (1 - t) * (control[1] - centre[1]) + 2 * t * (tip[1] - control[1]),
    ]);
  return { at, tangent };
}

/** Half width along the nail (0 at the base, 1 at the point): full, then an almond point. */
const halfWidth = (spec: NailSpec, s: number) =>
  spec.width * spec.r * (1 - s ** 1.9) ** 0.85 * (1 + 0.06 * Math.sin(Math.PI * s));

function nailShapes(spec: NailSpec) {
  const { at, tangent } = spine(spec);
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const [x, y] = at(s);
    const [tx, ty] = tangent(s);
    const h = halfWidth(spec, s);
    left.push([x - ty * h, y + tx * h]);
    right.push([x + ty * h, y - tx * h]);
  }

  // Which side of the nail faces the light.
  const [mx, my] = at(0.45);
  const [tx, ty] = tangent(0.45);
  const side = -ty * LIGHT[0] + tx * LIGHT[1] > 0 ? 1 : -1;
  const across = spec.width * spec.r;

  // The one soft reflection: a streak on the lit side, thin at both ends.
  const glossOut: Point[] = [];
  const glossIn: Point[] = [];
  const glossSteps = 20;
  for (let i = 0; i <= glossSteps; i++) {
    const u = i / glossSteps;
    const s = 0.28 + 0.5 * u;
    const [x, y] = at(s);
    const [gx, gy] = tangent(s);
    const h = halfWidth(spec, s);
    const cx = x - gy * 0.4 * h * side;
    const cy = y + gx * 0.4 * h * side;
    const w = 0.11 * h * Math.sin(Math.PI * u);
    glossOut.push([cx - gy * w, cy + gx * w]);
    glossIn.push([cx + gy * w, cy - gx * w]);
  }

  return {
    body: path([...left, ...right.reverse()]),
    gloss: path([...glossOut, ...glossIn.reverse()]),
    /** Lit edge to shaded edge, across the middle of the nail. */
    shine: {
      x1: r1(mx - ty * across * side),
      y1: r1(my + tx * across * side),
      x2: r1(mx + ty * across * side),
      y2: r1(my - tx * across * side),
    },
  };
}

const SHAPES = Object.fromEntries(
  Object.entries(NAILS).map(([name, spec]) => [name, nailShapes(spec)]),
) as Record<NailName, ReturnType<typeof nailShapes>>;

function NailDefs({ name, id }: { name: NailName; id: (name: string) => string }) {
  const { centre, r } = NAILS[name];
  const { shine } = SHAPES[name];
  return (
    <>
      <linearGradient id={id(`polish-${name}`)} gradientUnits="userSpaceOnUse" {...shine}>
        <stop offset="0" stopColor={POLISH.light} />
        <stop offset="0.45" stopColor={POLISH.base} />
        <stop offset="1" stopColor={POLISH.deep} />
      </linearGradient>
      {/* The finger's shadow where the nail leaves it. */}
      <radialGradient
        id={id(`seat-${name}`)}
        gradientUnits="userSpaceOnUse"
        cx={centre[0]}
        cy={centre[1]}
        r={r + 16}
      >
        <stop offset={r1(r / (r + 16))} stopColor={POLISH.shade} stopOpacity={0.55} />
        <stop offset="1" stopColor={POLISH.shade} stopOpacity={0} />
      </radialGradient>
    </>
  );
}

function Nail({ name, id }: { name: NailName; id: (name: string) => string }) {
  const { body, gloss } = SHAPES[name];
  return (
    <>
      <path d={body} fill={`url(#${id(`polish-${name}`)})`} />
      <path d={body} fill={`url(#${id(`seat-${name}`)})`} />
      <path d={gloss} fill="#FFFFFF" fillOpacity={0.8} />
      <path d={body} fill="none" stroke={POLISH.edge} strokeOpacity={0.35} strokeWidth={1.2} />
    </>
  );
}

const SPARK = `M${TOUCH[0] - 16} ${TOUCH[1] - 20}l-12-12M${TOUCH[0] - 22} ${TOUCH[1] + 2}h-16M${TOUCH[0] - 15} ${TOUCH[1] + 22}l-12 12`;

/** Android buzzes along with the three taps (0.47 s, 0.86 s, 1.25 s into the animation). */
const TAPS = [0, 470, 12, 378, 12, 378, 12];

export function ClockItArt({ className }: { className?: string }) {
  const uid = useId();
  const id = (name: string) => `${uid}${name}`;
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(TAPS);
  }, []);

  const names = Object.keys(NAILS) as NailName[];
  return (
    <svg viewBox="-28 -62 500 500" className={className} aria-hidden="true" focusable="false">
      <defs>
        {names.map((name) => (
          <NailDefs key={name} name={name} id={id} />
        ))}
      </defs>
      <g className="clock-it-hand">
        <Nail name="middle" id={id} />
        <Nail name="ring" id={id} />
        <Nail name="little" id={id} />
        <g className="clock-it-index">
          <Nail name="index" id={id} />
        </g>
        <g className="clock-it-thumb">
          <Nail name="thumb" id={id} />
        </g>
        <image href={CLOCK_IT_HAND} width={512} height={512} />
        <path
          className="clock-it-spark"
          d={SPARK}
          stroke={POLISH.base}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
}
