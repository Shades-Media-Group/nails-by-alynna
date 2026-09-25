import type { ServiceArt } from '@/types/api';

/**
 * The illustration collection staff pick from in Admin → Services, grouped the way they are
 * shown in the picker. Every drawing takes the category's colour.
 */
export const ART_GROUPS: Array<{ key: 'finishes' | 'designs' | 'care' | 'lengths' | 'refills'; arts: ServiceArt[] }> = [
  { key: 'finishes', arts: ['gel', 'french', 'ombre', 'chrome', 'glitter', 'extension', 'pedicure'] },
  { key: 'designs', arts: ['design', 'design-complex', 'design-3d', 'design-extra', 'crystals'] },
  { key: 'care', arts: ['removal', 'file', 'care'] },
  { key: 'lengths', arts: ['length-1', 'length-2', 'length-3', 'length-4', 'length-5', 'length-6'] },
  { key: 'refills', arts: ['refill-1', 'refill-2', 'refill-3', 'refill-4', 'refill-5', 'refill-6'] },
];

export const ALL_ARTS: ServiceArt[] = ART_GROUPS.flatMap((group) => group.arts);
