import type { HTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';

type Tone = 'white' | 'panel' | SwatchColor;

const TONES: Record<Tone, string> = {
  white: 'bg-white ring-1 ring-inset ring-ink-100 shadow-card',
  panel: 'bg-ink-50',
  blush: SWATCH.blush.field,
  cyan: SWATCH.cyan.field,
  peach: SWATCH.peach.field,
  mint: SWATCH.mint.field,
  lilac: SWATCH.lilac.field,
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  padded?: boolean;
  children?: ReactNode;
}

/** Surface with one elevation language: either a hairline+soft shadow (white) or a flat field. */
export function Card({ tone = 'white', padded = true, className, children, ...rest }: CardProps) {
  return (
    <div className={cx('rounded-xl', TONES[tone], padded && 'p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardLink({
  tone = 'white',
  padded = true,
  className,
  children,
  ...rest
}: LinkProps & { tone?: Tone; padded?: boolean }) {
  return (
    <Link
      className={cx(
        'press block rounded-xl outline-offset-4 transition-shadow hover:shadow-raised',
        TONES[tone],
        padded && 'p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
