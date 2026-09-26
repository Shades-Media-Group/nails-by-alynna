import type { ServiceArt } from '@/types/api';
import { along, d, sizeOf } from './geometry';
import { NATURAL, WHITE, mix, usePaint } from './paint';
import {
  CottonDefs,
  CottonPad,
  Crystal,
  CrystalDefs,
  Digit,
  DotFlower,
  GelFlower,
  Glitter,
  NailFile,
  Pearl,
  PearlDefs,
  PetalDefs,
  Pusher,
  SmileTip,
  Sparkle,
  ToolDefs,
  type DigitProps,
} from './parts';

/**
 * Every drawing is one fingertip close-up: the finger comes in from the bottom of the tile,
 * tilted a little, and the nail (about 60% of the tile's height) is the subject.
 */
const W = 44;
/** Nail bed: cuticle to the end of the fingertip. */
const NB = 0.78 * W;
/** Nail width: skin shows on both sides, so the finger reads around it. */
const NAIL_W = 0.68 * W;
const TILT = 12;
/** The free edge of an everyday nail: a medium length, 0.75× the nail bed. */
const EVERYDAY = (0.75 * NB) / W;

type NailProps = Omit<DigitProps, 'x' | 'y' | 'w' | 'angle' | 'ext'>;

interface FingerProps extends NailProps {
  /** Where the cuticle sits in the box; the finger hangs below it. */
  cx?: number;
  cy?: number;
  angle?: number;
  ext?: number;
}

/** The fingertip end for a digit whose cuticle is at (cx, cy), `yc` below its tip, tilted `angle`. */
function tipFrom(cx: number, cy: number, angle: number, yc: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + yc * Math.sin(rad), y: cy - yc * Math.cos(rad) };
}

function Finger({ cx = 46, cy = 76, angle = TILT, ext = EVERYDAY, ...nail }: FingerProps) {
  const p = tipFrom(cx, cy, angle, NB);
  return <Digit x={p.x} y={p.y} angle={angle} w={W} ext={ext} nail={{ nw: NAIL_W, yc: NB }} {...nail} />;
}

// ── Sizes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Sizes 1–6 are one series: the same finger in the same place, the free edge running from 0.3×
 * the nail bed (size 1, a short natural extension) to 1.1× (size 6, long but wearable) in even
 * steps. The shape is a sculpted almond: round when short, slimmer and pointier as it grows,
 * never a wide paddle. A dotted guide crosses every size's tip; the chosen one is dashed in the
 * swatch colour.
 */
const SIZE_CUTICLE = { x: 44, y: 79 };
const freeEdge = (level: number) => NB * (0.3 + 0.16 * (level - 1));
const tipY = (level: number) => SIZE_CUTICLE.y - (NB + freeEdge(level)) * Math.cos((TILT * Math.PI) / 180);
const LEVELS = [1, 2, 3, 4, 5, 6];

function Guides({ level }: { level: number }) {
  const paint = usePaint();
  return (
    <>
      {LEVELS.map((n) => {
        const current = n === level;
        return (
          <line
            key={n}
            x1={current ? 4 : 10}
            x2={current ? 96 : 90}
            y1={tipY(n)}
            y2={tipY(n)}
            stroke={current ? paint.accent : '#CBCDCC'}
            strokeWidth={current ? 2.4 : 1.6}
            strokeDasharray={current ? '5.6 4.2' : '1.2 3.6'}
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
}

function Size({ level, refill }: { level: number; refill: boolean }) {
  return (
    <Finger
      cx={SIZE_CUTICLE.x}
      cy={SIZE_CUTICLE.y}
      ext={freeEdge(level) / W}
      shape="sculpted"
      regrowth={refill ? 0.36 : undefined}
    />
  );
}

// ── Finishes ───────────────────────────────────────────────────────────────────────────────

function Ombre() {
  const paint = usePaint();
  return (
    <>
      <defs>
        <linearGradient id={paint.id('ombre')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(paint.accent, paint.deep, 0.15)} />
          <stop offset="0.3" stopColor={paint.accent} />
          <stop offset="0.72" stopColor={mix(NATURAL.bed, paint.accent, 0.28)} />
          <stop offset="1" stopColor={NATURAL.bed} />
        </linearGradient>
      </defs>
      <Finger fill={`url(#${paint.id('ombre')})`} dome="nude" />
    </>
  );
}

function Chrome() {
  const paint = usePaint();
  return (
    <>
      <defs>
        <linearGradient id={paint.id('chrome')} x1="0" y1="0" x2="1" y2="0.18">
          <stop offset="0" stopColor={paint.deep} />
          <stop offset="0.16" stopColor={mix(paint.accent, paint.deep, 0.25)} />
          <stop offset="0.3" stopColor={mix(paint.tint, WHITE, 0.6)} />
          <stop offset="0.38" stopColor={WHITE} />
          <stop offset="0.5" stopColor={mix(paint.accent, WHITE, 0.3)} />
          <stop offset="0.68" stopColor={paint.accent} />
          <stop offset="0.84" stopColor={paint.deep} />
          <stop offset="0.94" stopColor={mix(paint.tint, WHITE, 0.4)} />
          <stop offset="1" stopColor={paint.deep} />
        </linearGradient>
      </defs>
      <Finger fill={`url(#${paint.id('chrome')})`} />
    </>
  );
}

function GlitterNail() {
  return (
    <>
      <Finger decoration={(g) => <Glitter g={g} />} />
      <Sparkle x={76} y={14} s={6} />
      <Sparkle x={30} y={30} s={3.6} />
    </>
  );
}

function French() {
  const paint = usePaint();
  return <Finger fill={paint.url('nude')} dome="nude" decoration={(g) => <SmileTip g={g} />} />;
}

// ── Designs ────────────────────────────────────────────────────────────────────────────────

/** A simple design: a painted flower and a couple of dots. */
function Design() {
  const paint = usePaint();
  return (
    <Finger
      decoration={(g) => (
        <>
          <DotFlower x={0} y={along(g, 0.42)} r={g.nw * 0.2} fill={WHITE} centre={paint.deep} />
          <circle cx={-g.nw * 0.2} cy={along(g, 0.74)} r={g.nw * 0.06} fill={WHITE} />
          <circle cx={g.nw * 0.2} cy={along(g, 0.18)} r={g.nw * 0.05} fill={WHITE} />
        </>
      )}
    />
  );
}

/** A complex design: marble waves, a fine line, a small flower and dots, on a deep base. */
function DesignComplex() {
  const paint = usePaint();
  return (
    <Finger
      fill={paint.deep}
      decoration={(g) => {
        const { nw } = g;
        return (
          <>
            <path
              d={d`M${-nw} ${along(g, 0.52)}C${-nw * 0.3} ${along(g, 0.34)} ${nw * 0.1} ${along(g, 0.7)} ${nw} ${along(g, 0.44)}L${nw} ${along(g, 0.62)}C${nw * 0.1} ${along(g, 0.86)} ${-nw * 0.3} ${along(g, 0.5)} ${-nw} ${along(g, 0.7)}Z`}
              fill={WHITE}
            />
            <path
              d={d`M${-nw} ${along(g, 0.64)}C${-nw * 0.3} ${along(g, 0.46)} ${nw * 0.1} ${along(g, 0.82)} ${nw} ${along(g, 0.56)}`}
              stroke={paint.accent}
              strokeWidth={nw * 0.05}
              fill="none"
            />
            <path
              d={d`M${-nw} ${along(g, 0.3)}C${-nw * 0.2} ${along(g, 0.16)} ${nw * 0.2} ${along(g, 0.42)} ${nw} ${along(g, 0.24)}`}
              stroke={paint.tint}
              strokeWidth={nw * 0.035}
              fill="none"
            />
            <DotFlower x={nw * 0.08} y={along(g, 0.14)} r={nw * 0.1} fill={WHITE} centre={paint.accent} />
            <circle cx={-nw * 0.18} cy={along(g, 0.84)} r={nw * 0.05} fill={WHITE} />
            <circle cx={nw * 0.18} cy={along(g, 0.88)} r={nw * 0.04} fill={WHITE} />
          </>
        );
      }}
    />
  );
}

/** Sculpted 3D gel: a raised flower standing off the nail, pearls beside it. */
function Design3D() {
  const paint = usePaint();
  return (
    <>
      <defs>
        <PetalDefs from={WHITE} to={mix(paint.tint, WHITE, 0.3)} />
        <PearlDefs />
      </defs>
      <Finger
        over={(g) => (
          <>
            <GelFlower x={0} y={along(g, 0.44)} r={g.nw * 0.36} petal={`url(#${paint.id('petal')})`} />
            <Pearl x={g.nw * 0.2} y={along(g, 0.12)} r={g.nw * 0.08} />
            <Pearl x={-g.nw * 0.14} y={along(g, 0.78)} r={g.nw * 0.1} />
          </>
        )}
      />
    </>
  );
}

/** Extra design: a coloured tip, a 3D flower on the smile line, stones at the base. */
function DesignExtra() {
  const paint = usePaint();
  return (
    <>
      <defs>
        <PetalDefs from={WHITE} to={mix(paint.tint, WHITE, 0.3)} />
        <PearlDefs />
        <CrystalDefs />
      </defs>
      <Finger
        fill={paint.url('nude')}
        dome="nude"
        decoration={(g) => (
          <>
            <SmileTip g={g} fill={paint.accent} />
            {[0.18, 0.32].map((v) => (
              <circle key={v} cx={g.nw * (v - 0.25)} cy={along(g, v + 0.5)} r={g.nw * 0.045} fill={paint.accent} />
            ))}
          </>
        )}
        over={(g) => (
          <>
            <GelFlower x={g.nw * 0.04} y={along(g, 0.4)} r={g.nw * 0.26} petal={`url(#${paint.id('petal')})`} />
            <Crystal x={-g.nw * 0.16} y={along(g, 0.8)} r={g.nw * 0.1} />
            <Crystal x={g.nw * 0.12} y={along(g, 0.84)} r={g.nw * 0.075} />
          </>
        )}
      />
      <Sparkle x={80} y={20} s={5} />
    </>
  );
}

/** Rhinestones: a cluster at the base of the nail and a line running up it. */
function Crystals() {
  return (
    <>
      <defs>
        <CrystalDefs />
      </defs>
      <Finger
        over={(g) => {
          const { nw } = g;
          return (
            <>
              <Crystal x={0} y={along(g, 0.76)} r={nw * 0.17} />
              <Crystal x={-nw * 0.24} y={along(g, 0.86)} r={nw * 0.1} />
              <Crystal x={nw * 0.24} y={along(g, 0.86)} r={nw * 0.1} />
              <Crystal x={0} y={along(g, 0.56)} r={nw * 0.1} />
              <Crystal x={0} y={along(g, 0.42)} r={nw * 0.075} />
              <Crystal x={0} y={along(g, 0.31)} r={nw * 0.055} />
            </>
          );
        }}
      />
      <Sparkle x={78} y={18} s={6} />
      <Sparkle x={28} y={34} s={3.6} />
    </>
  );
}

// ── Removal and care ───────────────────────────────────────────────────────────────────────

/** Removal: polish half wiped off the nail, and the stained cotton pad that took it. */
function Removal() {
  const paint = usePaint();
  return (
    <>
      <defs>
        <CottonDefs />
      </defs>
      <Finger
        cx={38}
        cy={80}
        angle={8}
        natural
        decoration={(g) => {
          const { nw, yt, yc } = g;
          return (
            <path
              d={d`M${-nw} ${yt - 2}H${nw * 0.1}C${nw * 0.02} ${along(g, 0.2)} ${nw * 0.2} ${along(g, 0.32)} ${nw * 0.02} ${along(g, 0.46)}C${-nw * 0.1} ${along(g, 0.56)} ${nw * 0.05} ${along(g, 0.7)} ${-nw * 0.12} ${along(g, 0.82)}C${-nw * 0.2} ${along(g, 0.9)} ${-nw * 0.3} ${yc} ${-nw * 0.3} ${yc + 4}H${-nw}Z`}
              fill={paint.url('polish')}
            />
          );
        }}
      />
      <CottonPad x={78} y={36} r={17} />
    </>
  );
}

/** Taking off another salon's product: a file across the free edge, dust falling from it. */
function FileScene() {
  const paint = usePaint();
  return (
    <>
      <Finger cx={40} cy={80} angle={8} />
      <NailFile x={62} y={16} angle={-16} length={62} width={10.5} />
      {[
        [34, 26, 1.3],
        [30, 31, 0.9],
        [37, 32, 0.8],
        [27, 25, 0.7],
      ].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={paint.tint} />
      ))}
    </>
  );
}

/** Care after removal: a clean bare nail and a steel cuticle pusher at the cuticle. */
function Care() {
  return (
    <>
      <defs>
        <ToolDefs />
      </defs>
      <Finger cx={40} cy={80} angle={8} natural ext={0.3 * (NB / W)} shape="oval" />
      <Pusher x={42} y={74} angle={-52} />
    </>
  );
}

// ── Pedicure ───────────────────────────────────────────────────────────────────────────────

/** The big toe close-up, with the second toe beside it: short squoval nails. */
function Pedicure() {
  const big = { cx: 38, cy: 66, angle: -4, w: 54 };
  const second = { cx: 84, cy: 80, angle: 10, w: 30 };
  const bigNail = { nw: 0.7 * big.w, yc: 0.6 * big.w };
  const secondNail = { nw: 0.64 * second.w, yc: 0.58 * second.w };
  const b = tipFrom(big.cx, big.cy, big.angle, bigNail.yc);
  const s = tipFrom(second.cx, second.cy, second.angle, secondNail.yc);
  return (
    <>
      <Digit x={s.x} y={s.y} angle={second.angle} w={second.w} ext={0.05} shape="square" toe nail={secondNail} />
      <Digit x={b.x} y={b.y} angle={big.angle} w={big.w} ext={0.04} shape="square" toe front nail={bigNail} />
    </>
  );
}

/** The drawing for one art in the 100×100 box. */
export function Scene({ art }: { art: ServiceArt }) {
  const size = sizeOf(art);
  if (size) {
    return (
      <>
        <Guides level={size.level} />
        <Size level={size.level} refill={size.refill} />
      </>
    );
  }
  switch (art) {
    case 'french':
      return <French />;
    case 'ombre':
      return <Ombre />;
    case 'chrome':
      return <Chrome />;
    case 'glitter':
      return <GlitterNail />;
    case 'extension':
      return <Finger cy={84} cx={44} ext={(1.05 * NB) / W} shape="stiletto" />;
    case 'pedicure':
      return <Pedicure />;
    case 'design':
      return <Design />;
    case 'design-complex':
      return <DesignComplex />;
    case 'design-3d':
      return <Design3D />;
    case 'design-extra':
      return <DesignExtra />;
    case 'crystals':
      return <Crystals />;
    case 'removal':
      return <Removal />;
    case 'file':
      return <FileScene />;
    case 'care':
      return <Care />;
    case 'gel':
    default:
      return <Finger />;
  }
}

