import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '@/lib/cx';
import type { IconComponent } from './icons';

type Variant = 'plain' | 'soft' | 'outline' | 'ink';
type Size = 'md' | 'sm' | 'lg';

const VARIANTS: Record<Variant, string> = {
  plain: 'text-ink-900 hover:bg-ink-50',
  soft: 'bg-ink-50 text-ink-900 hover:bg-ink-100',
  outline: 'bg-white text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50',
  ink: 'bg-ink-900 text-white hover:bg-ink-800',
};
const SIZES: Record<Size, string> = { sm: 'size-9 text-[1.15rem]', md: 'size-11 text-[1.35rem]', lg: 'size-12 text-[1.5rem]' };

interface Props {
  icon: IconComponent;
  /** Required: icon-only controls need an accessible name. */
  label: string;
  variant?: Variant;
  size?: Size;
}

function classes(variant: Variant, size: Size, className?: string) {
  return cx(
    'press inline-flex shrink-0 items-center justify-center rounded-pill disabled:opacity-40',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const IconButton = forwardRef<HTMLButtonElement, Props & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(
  function IconButton({ icon: Icon, label, variant = 'plain', size = 'md', className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} title={label} className={classes(variant, size, className)} {...rest}>
        <Icon fontSize="inherit" />
      </button>
    );
  },
);

export function IconLink({ icon: Icon, label, variant = 'plain', size = 'md', className, ...rest }: Props & Omit<LinkProps, 'children'>) {
  return (
    <Link aria-label={label} title={label} className={classes(variant, size, className)} {...rest}>
      <Icon fontSize="inherit" />
    </Link>
  );
}
