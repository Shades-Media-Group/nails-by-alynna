import { createContext, useContext } from 'react';

/**
 * Colours of the nail illustrations. Polish comes from the category swatch; skin and natural
 * nail are fixed: one warm, neutral beige that reads on all five pastel fields.
 */
export const WHITE = '#FFFFFF';
export const INK = '#252726';

export const SKIN = {
  light: '#F7D9C3',
  base: '#EEC2A2',
  shade: '#DDA482',
  edge: '#C98C69',
  crease: '#B4775A',
  /** Fingertips and toe tips are a little pinker. */
  flush: '#EBA595',
};

/** Bare natural nail: pink nail bed, pale free edge. */
export const NATURAL = {
  bed: '#F4C5BC',
  bedDeep: '#E7A79C',
  edge: '#FCF3EE',
  moon: '#FAE0D9',
};

/** Brushed steel for tools. */
export const STEEL = { light: '#F2F4F4', base: '#C5CBCC', dark: '#8A9395' };

/** Mixes two #RRGGBB colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i += 1) {
    const value = Math.round(channel(a, i) * (1 - t) + channel(b, i) * t);
    out += value.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

export interface Paint {
  /** Swatch colours for this drawing. */
  accent: string;
  deep: string;
  field: string;
  /** Accent lifted toward white (highlights, glitter, petals). */
  tint: string;
  /** `url(#…)` of a shared gradient defined once per drawing. */
  url: (name: PaintName) => string;
  /** A unique id for gradients a scene defines itself. */
  id: (name: string) => string;
}

export type PaintName = 'polish' | 'dome' | 'domeNude' | 'natural' | 'nude' | 'gloss';

export const PaintContext = createContext<Paint | null>(null);

export function usePaint(): Paint {
  const paint = useContext(PaintContext);
  if (!paint) throw new Error('Nail parts render inside <RealisticNailArt>.');
  return paint;
}
