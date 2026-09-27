import { useEffect, useId } from 'react';
import { CLOCK_IT_HAND } from './clockItHand';

/**
 * "Clock it": the ballroom-slang hand sign for "noticed, yes!". A raised hand with long pink
 * nails, three fingers up, and the thumb tapping its nail against the index nail, three times.
 * Still (nails touching) for people who switched motion off.
 *
 * The hand is Google's Noto 3D "OK hand" emoji (Apache 2.0, see src/assets/clock-it/NOTICE.md),
 * placed at 0 0 512 512, with its thumb bent down a little so the long nails meet tip to tip, as
 * in the meme. The tap is three pictures of the thumb (resting, halfway, down). The nails are
 * drawn here, under the hand: each one runs straight on from its fingertip, which covers the
 * nail's base the way it does seen from the palm side.
 */

type Point = readonly [number, number];

interface NailSpec {
  /** The rounded fingertip in the picture: its centre and radius. */
  centre: Point;
  r: number;
  /** Where the nail's point ends. */
  tip: Point;
}

const unit = ([x, y]: Point): Point => {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
};

/** Straight on from the fingertip, `length` past it. */
const along = (centre: Point, r: number, dir: Point, length: number): Point => {
  const [dx, dy] = unit(dir);
  return [centre[0] + dx * (r + length), centre[1] + dy * (r + length)];
};

/** The thumb's base: the pictures bend the emoji's thumb down around it. */
const THUMB_BASE: Point = [250, 470];

/** Turns a point `degrees` down (counter-clockwise on screen) around `around`. */
function bendDown([x, y]: Point, degrees: number, around: Point = THUMB_BASE): Point {
  const a = (degrees * Math.PI) / 180;
  const dx = x - around[0];
  const dy = y - around[1];
  return [
    around[0] + dx * Math.cos(a) + dy * Math.sin(a),
    around[1] - dx * Math.sin(a) + dy * Math.cos(a),
  ];
}

/** The index fingertip, and the thumb tip as it rests in `hand.webp` (bent 10° from the emoji). */
const INDEX = { centre: [142, 278.1] as Point, r: 20.5, dir: unit([-0.989, 0.15]) };
const THUMB = {
  centre: bendDown([134.2, 326.2], 10),
  r: 21.6,
  dir: unit(bendDown([-0.45, -0.89], 10, [0, 0])),
};

/** Where the two nails meet: the index nail and the thumb nail, each straight on from its finger. */
const TOUCH: Point = (() => {
  const [ix, iy] = INDEX.dir;
  const [tx, ty] = THUMB.dir;
  const bx = THUMB.centre[0] - INDEX.centre[0];
  const by = THUMB.centre[1] - INDEX.centre[1];
  const s = (bx * -ty + tx * by) / (ix * -ty + tx * iy);
  return [INDEX.centre[0] + ix * s, INDEX.centre[1] + iy * s];
})();

const NAILS = {
  middle: { centre: [258.4, 41.7], r: 24.4, tip: along([258.4, 41.7], 24.4, [-0.52, -0.85], 68) },
  ring: { centre: [241, 67.1], r: 20.5, tip: along([241, 67.1], 20.5, [-0.45, -0.89], 58) },
  little: { centre: [233, 121.9], r: 14.6, tip: along([233, 121.9], 14.6, [-0.5, -0.87], 44) },
  index: { centre: INDEX.centre, r: INDEX.r, tip: TOUCH },
  thumb: { centre: THUMB.centre, r: THUMB.r, tip: TOUCH },
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

/** Half the nail's width along it (0 at the base, 1 at the point): full, then an almond point. */
const halfWidth = (r: number, s: number) =>
  0.72 * r * (1 - s ** 1.9) ** 0.85 * (1 + 0.06 * Math.sin(Math.PI * s));

function nailShapes({ centre, r, tip }: NailSpec) {
  const at = (s: number): Point => [
    centre[0] + (tip[0] - centre[0]) * s,
    centre[1] + (tip[1] - centre[1]) * s,
  ];
  const [tx, ty] = unit([tip[0] - centre[0], tip[1] - centre[1]]);
  // Which side of the nail faces the light.
  const side = -ty * LIGHT[0] + tx * LIGHT[1] > 0 ? 1 : -1;

  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const s = i / 32;
    const [x, y] = at(s);
    const h = halfWidth(r, s);
    left.push([x - ty * h, y + tx * h]);
    right.push([x + ty * h, y - tx * h]);
  }

  // The one soft reflection: a streak on the lit side, thin at both ends.
  const glossOut: Point[] = [];
  const glossIn: Point[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const s = 0.28 + 0.5 * u;
    const [x, y] = at(s);
    const h = halfWidth(r, s);
    const cx = x - ty * 0.4 * h * side;
    const cy = y + tx * 0.4 * h * side;
    const w = 0.11 * h * Math.sin(Math.PI * u);
    glossOut.push([cx - ty * w, cy + tx * w]);
    glossIn.push([cx + ty * w, cy - tx * w]);
  }

  // Lit edge to shaded edge, across the middle of the nail.
  const [mx, my] = at(0.45);
  const across = 0.72 * r * side;
  return {
    body: path([...left, ...right.reverse()]),
    gloss: path([...glossOut, ...glossIn.reverse()]),
    shine: {
      x1: r1(mx - ty * across),
      y1: r1(my + tx * across),
      x2: r1(mx + ty * across),
      y2: r1(my - tx * across),
    },
  };
}

const SHAPES = Object.fromEntries(
  Object.entries(NAILS).map(([name, spec]) => [name, nailShapes(spec)]),
) as Record<NailName, ReturnType<typeof nailShapes>>;

function NailDefs({ name, id }: { name: NailName; id: (name: string) => string }) {
  const { centre, r } = NAILS[name];
  return (
    <>
      <linearGradient
        id={id(`polish-${name}`)}
        gradientUnits="userSpaceOnUse"
        {...SHAPES[name].shine}
      >
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

const SPARK = `M${r1(TOUCH[0] - 16)} ${r1(TOUCH[1] - 20)}l-12-12M${r1(TOUCH[0] - 22)} ${r1(TOUCH[1] + 2)}h-16M${r1(TOUCH[0] - 15)} ${r1(TOUCH[1] + 22)}l-12 12`;

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
        <Nail name="index" id={id} />
        {/* The thumb nail turns with the thumb, around the thumb's base. */}
        <g className="clock-it-thumb">
          <Nail name="thumb" id={id} />
        </g>
        <image
          className="clock-it-frame clock-it-open"
          href={CLOCK_IT_HAND.open}
          width={512}
          height={512}
        />
        <image
          className="clock-it-frame clock-it-mid"
          href={CLOCK_IT_HAND.mid}
          width={512}
          height={512}
        />
        <image
          className="clock-it-frame clock-it-rest"
          href={CLOCK_IT_HAND.rest}
          width={512}
          height={512}
        />
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
