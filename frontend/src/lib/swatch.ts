export type SwatchColor = 'blush' | 'cyan' | 'peach' | 'mint' | 'lilac';

/**
 * Swatch fields — the pastel "polish chart" of the brand. Each swatch has a field color,
 * a readable ink for text on that field (AA), and a saturated accent for art and icons.
 */
export const SWATCH: Record<SwatchColor, { field: string; ink: string; accent: string; hex: { field: string; accent: string; deep: string } }> = {
  blush: {
    field: 'bg-blush-100',
    ink: 'text-rose-700',
    accent: 'text-rose-500',
    hex: { field: '#FDE7FC', accent: '#FD2578', deep: '#B80C4D' },
  },
  cyan: {
    field: 'bg-cyan-50',
    ink: 'text-cyan-800',
    accent: 'text-cyan-500',
    hex: { field: '#EDFDFE', accent: '#3DBFCC', deep: '#155C63' },
  },
  peach: {
    field: 'bg-peach-50',
    ink: 'text-peach-800',
    accent: 'text-peach-500',
    hex: { field: '#FFF6E9', accent: '#FD9B1D', deep: '#7A4400' },
  },
  mint: {
    field: 'bg-mint-50',
    ink: 'text-mint-700',
    accent: 'text-mint-500',
    hex: { field: '#EDFBF3', accent: '#2EBD7A', deep: '#157A4A' },
  },
  lilac: {
    field: 'bg-lilac-50',
    ink: 'text-lilac-700',
    accent: 'text-lilac-500',
    hex: { field: '#F4F0FF', accent: '#8B6CF0', deep: '#5A3EC2' },
  },
};

export const SWATCH_ORDER: SwatchColor[] = ['blush', 'cyan', 'peach', 'mint', 'lilac'];
