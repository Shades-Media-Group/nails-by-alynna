import { useEffect, useId } from 'react';
import { SKIN } from './paint';

/**
 * "Clock it": the ballroom-slang hand sign for "noticed, yes!", as the meme draws it. A raised
 * hand, palm forward, long almond nails; index, ring and little finger up, the middle finger
 * bent over to meet the thumb, and the two nails tap tip to tip, three times. A ring on the
 * ring finger and pearls at the wrist, like the memes. Still (nails touching) for people who
 * switched motion off.
 *
 * Every finger is drawn along a curved spine (a quadratic curve from its knuckle to its tip)
 * that tapers toward the tip, and its nail grows out of the tip along the same curve.
 */

type Point = readonly [number, number];
interface FingerSpec {
  base: Point;
  control: Point;
  tip: Point;
  /** Width at the knuckle and at the tip. */
  w0: number;
  w1: number;
  /** How far the nail reaches past the fingertip. */
  nail: number;
}

const FINGERS = {
  index: { base: [44.5, 53], control: [38, 32], tip: [32, 14], w0: 8.8, w1: 6.4, nail: 13 },
  ring: { base: [60, 51], control: [62.5, 30], tip: [61.5, 10], w0: 8.8, w1: 6.4, nail: 13.5 },
  pinky: { base: [68, 55], control: [73.5, 41], tip: [77, 27], w0: 7.8, w1: 5.6, nail: 11 },
  middle: { base: [52, 51], control: [37, 20], tip: [24.5, 38], w0: 9.2, w1: 6.8, nail: 10.5 },
  thumb: { base: [45, 74], control: [31, 64.5], tip: [23.5, 51.5], w0: 11.2, w1: 8.4, nail: 8.8 },
} satisfies Record<string, FingerSpec>;

/** Where the middle-finger and thumb nails meet. */
const TOUCH: Point = [20.1, 45.5];

const r1 = (v: number) => Math.round(v * 10) / 10;
const path = (points: Point[]) => `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L')} Z`;

function at({ base, control, tip }: FingerSpec, t: number): Point {
  const a = (1 - t) ** 2;
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * base[0] + b * control[0] + c * tip[0], a * base[1] + b * control[1] + c * tip[1]];
}

function direction({ base, control, tip }: FingerSpec, t: number): Point {
  const dx = 2 * (1 - t) * (control[0] - base[0]) + 2 * t * (tip[0] - control[0]);
  const dy = 2 * (1 - t) * (control[1] - base[1]) + 2 * t * (tip[1] - control[1]);
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

/** The finger: flat at the knuckle (the palm covers it), rounded at the tip. */
function fingerPath(spec: FingerSpec): string {
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = at(spec, t);
    const [tx, ty] = direction(spec, t);
    const half = (spec.w0 + (spec.w1 - spec.w0) * t) / 2;
    left.push([x - ty * half, y + tx * half]);
    right.push([x + ty * half, y - tx * half]);
  }
  const [tx, ty] = direction(spec, 1);
  const r = spec.w1 / 2;
  const cap: Point[] = [];
  for (let k = 1; k < 12; k++) {
    const a = (Math.PI * k) / 12;
    cap.push([
      spec.tip[0] - ty * r * Math.cos(a) + tx * r * Math.sin(a),
      spec.tip[1] + tx * r * Math.cos(a) + ty * r * Math.sin(a),
    ]);
  }
  return path([...left, ...cap, ...right.reverse()]);
}

/** The long almond nail, out of the fingertip along the finger's own curve, and its gloss. */
function nailPaths(spec: FingerSpec): { body: string; gloss: string } {
  const [tx, ty] = direction(spec, 1);
  const width = spec.w1 * 0.92;
  const start: Point = [spec.tip[0] - tx * width * 0.35, spec.tip[1] - ty * width * 0.35];
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const half = (width / 2) * (1 - s ** 1.9) * (1 + 0.08 * Math.sin(s * Math.PI));
    const cx = start[0] + tx * spec.nail * s;
    const cy = start[1] + ty * spec.nail * s;
    left.push([cx - ty * half, cy + tx * half]);
    right.push([cx + ty * half, cy - tx * half]);
  }
  const g = (s: number, side: number): Point => [
    start[0] + tx * spec.nail * s - ty * width * side,
    start[1] + ty * spec.nail * s + tx * width * side,
  ];
  const [g0, g1] = [g(0.22, 0.18), g(0.78, 0.06)];
  return {
    body: path([...left, ...right.reverse()]),
    gloss: `M${r1(g0[0])} ${r1(g0[1])} L${r1(g1[0])} ${r1(g1[1])}`,
  };
}

const SHAPES = Object.fromEntries(
  Object.entries(FINGERS).map(([name, spec]) => [
    name,
    { finger: fingerPath(spec), ...nailPaths(spec) },
  ]),
) as Record<keyof typeof FINGERS, { finger: string; body: string; gloss: string }>;

const PALM =
  'M43 52 C48 49.5 64 48.5 71 52.5 C75.5 55 77.2 60 76 68 C74.8 77 72 86 70 94 L68 112 L47 112 C47 104 45.5 96 43.5 89 C40.8 81 39.6 72 40 64 C40.3 58 40.8 54 43 52 Z';
const PEARLS: Point[] = [
  [47.5, 99],
  [51.5, 100.4],
  [55.6, 101],
  [59.7, 100.8],
  [63.8, 99.9],
  [67.6, 98.4],
];

/** Android buzzes along with the three taps (0.47 s, 0.86 s, 1.25 s into the animation). */
const TAPS = [0, 470, 12, 378, 12, 378, 12];

export function ClockItArt({ className }: { className?: string }) {
  const uid = useId();
  const id = (name: string) => `${uid}${name}`;
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(TAPS);
  }, []);

  const skin = {
    fill: `url(#${id('skin')})`,
    stroke: SKIN.edge,
    strokeOpacity: 0.6,
    strokeWidth: 0.7,
    strokeLinejoin: 'round' as const,
  };
  const Finger = ({ name }: { name: keyof typeof FINGERS }) => (
    <>
      <path d={SHAPES[name].finger} {...skin} />
      <path d={SHAPES[name].body} fill={`url(#${id('polish')})`} />
      <path
        d={SHAPES[name].gloss}
        stroke="#FFFFFF"
        strokeOpacity={0.75}
        strokeWidth={0.9}
        strokeLinecap="round"
      />
    </>
  );

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id('skin')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={SKIN.light} />
          <stop offset="1" stopColor={SKIN.shade} />
        </linearGradient>
        <linearGradient id={id('polish')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7AAB" />
          <stop offset="0.5" stopColor="#FD2578" />
          <stop offset="1" stopColor="#B80C4D" />
        </linearGradient>
        <radialGradient id={id('pearl')} cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9E1E6" />
        </radialGradient>
      </defs>
      <Finger name="index" />
      <Finger name="ring" />
      <Finger name="pinky" />
      {/* A thin silver ring on the ring finger. */}
      <path
        d="M57.4 37.6 Q62 39.8 66.4 37.6"
        stroke="#C9CDD1"
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M58 37 Q62 38.9 65.8 37"
        stroke="#FFFFFF"
        strokeOpacity={0.8}
        strokeWidth={0.7}
        fill="none"
        strokeLinecap="round"
      />
      <g className="clock-it-middle">
        <Finger name="middle" />
      </g>
      <g className="clock-it-thumb">
        <Finger name="thumb" />
      </g>
      {/* The palm goes over the knuckles, so every finger grows out of it. */}
      <path d={PALM} {...skin} />
      <path
        d="M47 76 C53 72 61 71 68 73"
        stroke={SKIN.crease}
        strokeOpacity={0.3}
        strokeWidth={0.8}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M45.5 84 C49 80 54 78.5 58 78.5"
        stroke={SKIN.crease}
        strokeOpacity={0.25}
        strokeWidth={0.7}
        fill="none"
        strokeLinecap="round"
      />
      {PEARLS.map(([x, y]) => (
        <circle
          key={x}
          cx={x}
          cy={y}
          r={2.2}
          fill={`url(#${id('pearl')})`}
          stroke="#D9D2D6"
          strokeWidth={0.4}
        />
      ))}
      <g className="clock-it-spark" fill="#FFFFFF">
        <path
          d={`M${TOUCH[0] - 6} ${TOUCH[1] - 5}l-2.2-2.2M${TOUCH[0] - 7} ${TOUCH[1] + 1}h-3M${TOUCH[0] - 5} ${TOUCH[1] + 6}l-2.2 2.2`}
          stroke="#FD2578"
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
