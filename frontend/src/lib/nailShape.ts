import type { NailShape } from '@/types/api';

/** The nail shapes a client picks from when booking, in the order the picker shows them. */
export const NAIL_SHAPES: readonly NailShape[] = ['square', 'almond', 'round', 'stiletto'];

/** A shape from the booking link (`?shape=`), or null when it is missing or not one of ours. */
export function parseNailShape(value: string | null | undefined): NailShape | null {
  return NAIL_SHAPES.find((shape) => shape === value) ?? null;
}
