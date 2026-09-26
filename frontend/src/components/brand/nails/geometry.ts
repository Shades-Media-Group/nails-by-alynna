/**
 * Outlines for the nail illustrations, in a finger's own coordinates: the finger points up (−y),
 * the end of the fingertip sits at the origin and the finger runs down (+y) toward the hand.
 * Units are those of the 100×100 art box.
 */

/** `sculpted`: an extension that tapers along its whole free edge (the size series). */
export type NailShape = 'almond' | 'oval' | 'stiletto' | 'square' | 'sculpted';

export interface NailGeometry {
  /** Width of the nail plate. */
  nw: number;
  /** Lowest point of the cuticle arc (the nail's base). */
  yc: number;
  /** The free edge: 0 is level with the fingertip, negative is past it. */
  yt: number;
  shape: NailShape;
}

/** `length-3` → size 3 of a new set; `refill-3` → size 3 of a refill; anything else → null. */
export function sizeOf(art: string): { level: number; refill: boolean } | null {
  const match = /^(length|refill)-([1-6])$/.exec(art);
  return match ? { level: Number(match[2]), refill: match[1] === 'refill' } : null;
}

/** Path template that rounds every number to 2 decimals (keeps the markup small). */
export function d(strings: TemplateStringsArray, ...values: number[]): string {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += String(Math.round(value * 100) / 100) + (strings[i + 1] ?? '');
  });
  return out;
}

/** Where the cuticle arc meets the side walls of the nail. */
export const arcEnd = (g: NailGeometry) => g.yc - 0.3 * g.nw;

/** A point along the nail's centre line: 0 at the free edge, 1 at the cuticle. */
export const along = (g: NailGeometry, v: number) => g.yt + (g.yc - g.yt) * v;

/** Length of the tapered free-edge zone for the shape (almond tapers long, square barely). */
export function tipZone(g: NailGeometry): number {
  const span = arcEnd(g) - g.yt;
  switch (g.shape) {
    case 'square':
      return Math.min(span * 0.35, 0.3 * g.nw);
    case 'oval':
      return Math.min(span * 0.6, 0.8 * g.nw);
    case 'stiletto':
      return span * 0.78;
    case 'sculpted':
      // The taper starts where the nail leaves the fingertip, whatever the length (and wherever
      // the cuticle is, so a refill's polish keeps the outline of the nail under it).
      return Math.min(span, Math.max(0.7 * g.nw, -g.yt + 0.15 * g.nw));
    case 'almond':
    default:
      return Math.min(span * 0.7, 1.15 * g.nw);
  }
}

/** Half widths of the nail: at the cuticle, and where the free-edge taper starts. */
const halfWidths = (g: NailGeometry) => ({ a0: (g.nw / 2) * 0.92, a: g.nw / 2 });

/** The nail plate: a U-shaped cuticle, sides that widen a touch, then the shaped free edge. */
export function nailPath(g: NailGeometry): string {
  const { a0, a } = halfWidths(g);
  const ya = arcEnd(g);
  const k = g.yc + (g.yc - ya) / 3;
  const T = tipZone(g);
  const ys = g.yt + T;
  const t = g.yt;
  let tip: string;
  switch (g.shape) {
    case 'square':
      tip = d`C${-a} ${t + T * 0.2} ${-a * 0.72} ${t} 0 ${t}C${a * 0.72} ${t} ${a} ${t + T * 0.2} ${a} ${ys}`;
      break;
    case 'oval':
      tip = d`C${-a} ${ys - T * 0.72} ${-a * 0.58} ${t} 0 ${t}C${a * 0.58} ${t} ${a} ${ys - T * 0.72} ${a} ${ys}`;
      break;
    case 'stiletto':
      tip = d`C${-a} ${ys - T * 0.42} ${-a * 0.16} ${t + T * 0.08} 0 ${t}C${a * 0.16} ${t + T * 0.08} ${a} ${ys - T * 0.42} ${a} ${ys}`;
      break;
    case 'sculpted': {
      // Short extensions end round; long ones curve in sooner and end in a soft almond point.
      const q = Math.min(1, Math.max(0, (-g.yt / g.nw - 0.3) / 0.9));
      const k1 = 0.55 - 0.25 * q;
      const k2 = 0.5 - 0.3 * q;
      tip = d`C${-a} ${ys - T * k1} ${-a * k2} ${t} 0 ${t}C${a * k2} ${t} ${a} ${ys - T * k1} ${a} ${ys}`;
      break;
    }
    case 'almond':
    default:
      tip = d`C${-a} ${ys - T * 0.52} ${-a * 0.3} ${t} 0 ${t}C${a * 0.3} ${t} ${a} ${ys - T * 0.52} ${a} ${ys}`;
  }
  return d`M${-a0} ${ya}L${-a} ${ys}` + tip + d`L${a0} ${ya}C${a0} ${k} ${-a0} ${k} ${-a0} ${ya}Z`;
}

/** The cuticle line alone, shifted down by `shift` (the fold's lit rim sits just below it). */
export function cuticlePath(g: NailGeometry, shift = 0): string {
  const { a0 } = halfWidths(g);
  const ya = arcEnd(g) + shift;
  const k = g.yc + (g.yc - arcEnd(g)) / 3 + shift;
  return d`M${-a0} ${ya}C${-a0} ${k} ${a0} ${k} ${a0} ${ya}`;
}

/**
 * The skin folds the nail is tucked into. `arc` is the cuticle (stroked in skin over the nail's
 * base); `left` and `right` are the side folds, thin wedges that lap over the nail's edges and
 * taper to nothing `up` above the cuticle; `leftEdge` and `rightEdge` are their inner edges
 * (for the shadow line on the nail).
 */
export function folds(g: NailGeometry, up: number) {
  const { a0, a } = halfWidths(g);
  const ya = arcEnd(g);
  const ys = g.yt + tipZone(g);
  const rise = Math.min(up, ya - ys);
  const xs = a0 + ((a - a0) * rise) / Math.max(ya - ys, 1);
  const top = ya - rise;
  const side = (sign: 1 | -1) => {
    const x0 = -sign * a0;
    const x1 = -sign * xs;
    const inner = d`M${x0 + sign * 1.1} ${ya + 0.4}C${x0 + sign * 1.1} ${ya - rise * 0.4} ${x1 + sign * 0.35} ${top + rise * 0.25} ${x1} ${top}`;
    const wedge =
      d`M${x0 - sign * 1.4} ${ya + 1.2}L${x0 + sign * 1.1} ${ya + 0.4}` +
      d`C${x0 + sign * 1.1} ${ya - rise * 0.4} ${x1 + sign * 0.35} ${top + rise * 0.25} ${x1} ${top}` +
      d`C${x1 - sign * 0.6} ${top + rise * 0.25} ${x0 - sign * 1.4} ${ya - rise * 0.4} ${x0 - sign * 1.4} ${ya + 1.2}Z`;
    return { inner, wedge };
  };
  const left = side(1);
  const right = side(-1);
  return { arc: cuticlePath(g), left: left.wedge, right: right.wedge, leftEdge: left.inner, rightEdge: right.inner };
}

/**
 * A finger seen from the back of the hand: a rounded pad at the tip, sides that ease in a
 * little below the nail and widen toward the knuckle, all smooth curves. `len` runs down past
 * the art box, where the tile crops it.
 */
export function fingerPath(w: number, len: number): string {
  return (
    d`M${-0.55 * w} ${len}C${-0.53 * w} ${1.3 * w} ${-0.459 * w} ${1.0 * w} ${-0.48 * w} ${0.7 * w}` +
    d`C${-0.5 * w} ${0.42 * w} ${-0.47 * w} ${0.1 * w} ${-0.22 * w} ${0.015 * w}` +
    d`C${-0.1 * w} ${-0.026 * w} ${0.1 * w} ${-0.026 * w} ${0.22 * w} ${0.015 * w}` +
    d`C${0.47 * w} ${0.1 * w} ${0.5 * w} ${0.42 * w} ${0.48 * w} ${0.7 * w}` +
    d`C${0.459 * w} ${1.0 * w} ${0.53 * w} ${1.3 * w} ${0.55 * w} ${len}Z`
  );
}

/** A toe: broader and rounder than a finger. */
export function toePath(w: number, len: number): string {
  return (
    d`M${-0.52 * w} ${len}C${-0.5 * w} ${0.95 * w} ${-0.51 * w} ${0.72 * w} ${-0.5 * w} ${0.48 * w}` +
    d`C${-0.49 * w} ${0.16 * w} ${-0.3 * w} ${-0.01 * w} 0 ${-0.01 * w}` +
    d`C${0.3 * w} ${-0.01 * w} ${0.49 * w} ${0.16 * w} ${0.5 * w} ${0.48 * w}` +
    d`C${0.51 * w} ${0.72 * w} ${0.5 * w} ${0.95 * w} ${0.52 * w} ${len}Z`
  );
}

/** The one soft reflection on a glossy nail: a streak down the left side, bending in near the tip. */
export function glossPath(g: NailGeometry): string {
  const { nw } = g;
  const bottom = arcEnd(g) - 0.04 * nw;
  const top = g.yt + Math.min(0.3 * nw, tipZone(g) * 0.4);
  const L = bottom - top;
  const hw = 0.065 * nw;
  const x0 = -0.24 * nw;
  const x3 = -0.1 * nw;
  const c1 = { x: -0.3 * nw, y: bottom - L * 0.42 };
  const c2 = { x: -0.27 * nw, y: top + L * 0.14 };
  return d`M${x0} ${bottom}C${c1.x - hw} ${c1.y} ${c2.x - hw} ${c2.y} ${x3} ${top}C${c2.x + hw} ${c2.y} ${c1.x + hw} ${c1.y} ${x0} ${bottom}Z`;
}

/** The region above a smile line (French tips), clipped to the nail by the caller. */
export function smileTipPath(g: NailGeometry, centre: number, sides: number): string {
  const a = g.nw / 2 + 2;
  return d`M${-a} ${sides}C${-a * 0.45} ${centre} ${a * 0.45} ${centre} ${a} ${sides}L${a} ${g.yt - 4}L${-a} ${g.yt - 4}Z`;
}
