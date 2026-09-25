import { cx } from '@/lib/cx';
import { SWATCH, SWATCH_ORDER, type SwatchColor } from '@/lib/swatch';

function colorFor(seed: string): SwatchColor {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SWATCH_ORDER[hash % SWATCH_ORDER.length] ?? 'blush';
}

const SIZES = { sm: 'size-9 text-xs', md: 'size-11 text-sm', lg: 'size-16 text-lg', xl: 'size-20 text-xl' } as const;

/** Initials on a swatch field — no photos to collect, no generic silhouettes. */
export function Avatar({
  name,
  surname,
  color,
  size = 'md',
  className,
}: {
  name: string;
  surname?: string;
  color?: SwatchColor;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initials = `${name.trim()[0] ?? ''}${surname?.trim()[0] ?? ''}`.toUpperCase() || '·';
  const swatch = SWATCH[color ?? colorFor(`${name}${surname ?? ''}`)];
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-pill font-bold tracking-wide',
        swatch.field,
        swatch.ink,
        SIZES[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
