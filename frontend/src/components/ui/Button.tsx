import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '@/lib/cx';
import { Spinner } from './Spinner';
import type { IconComponent } from './icons';

export type ButtonVariant = 'primary' | 'soft' | 'outline' | 'ghost' | 'brand' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

const VARIANTS: Record<ButtonVariant, string> = {
  // The one action color: ink pill.
  primary: 'bg-ink-900 text-white hover:bg-ink-800 shadow-[0_8px_20px_-12px_rgb(37_39_38/0.7)]',
  // Figma "Login With Email": blush field, ink label.
  soft: 'bg-blush-100 text-ink-900 hover:bg-blush-200',
  // Figma "Continue with Google": hairline pill.
  outline: 'bg-white text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300',
  ghost: 'bg-transparent text-ink-900 hover:bg-ink-50',
  brand: 'bg-rose-600 text-white hover:bg-rose-700',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const SIZES: Record<ButtonSize, string> = {
  lg: 'h-14 px-6 text-base gap-2.5',
  md: 'h-12 px-5 text-[0.9375rem] gap-2',
  sm: 'h-10 px-4 text-sm gap-1.5',
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconComponent;
  trailingIcon?: IconComponent;
  fullWidth?: boolean;
  children?: ReactNode;
}

function classes({ variant = 'primary', size = 'lg', fullWidth }: CommonProps, className?: string) {
  return cx(
    'press relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-pill font-semibold',
    'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}

function Content({ icon: Icon, trailingIcon: Trailing, loading, children, size = 'lg' }: CommonProps & { loading?: boolean }) {
  const iconSize = size === 'sm' ? 'text-lg' : 'text-[1.3rem]';
  return (
    <>
      {loading ? <Spinner className="size-5" /> : Icon ? <Icon className={iconSize} fontSize="inherit" /> : null}
      {children ? <span className="truncate">{children}</span> : null}
      {Trailing && !loading ? <Trailing className={iconSize} fontSize="inherit" /> : null}
    </>
  );
}

export interface ButtonProps extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, trailingIcon, fullWidth, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes({ variant, size, fullWidth }, className)}
      {...rest}
    >
      <Content icon={icon} trailingIcon={trailingIcon} loading={loading} size={size}>
        {children}
      </Content>
    </button>
  );
});

export interface ButtonLinkProps extends CommonProps, Omit<LinkProps, 'children'> {}

export function ButtonLink({ variant, size, icon, trailingIcon, fullWidth, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes({ variant, size, fullWidth }, className)} {...rest}>
      <Content icon={icon} trailingIcon={trailingIcon} size={size}>
        {children}
      </Content>
    </Link>
  );
}

/** Plain anchor with button styling (tel:, mailto:, external links). */
export function ButtonAnchor({
  variant,
  size,
  icon,
  trailingIcon,
  fullWidth,
  className,
  children,
  ...rest
}: CommonProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) {
  return (
    <a className={classes({ variant, size, fullWidth }, className)} {...rest}>
      <Content icon={icon} trailingIcon={trailingIcon} size={size}>
        {children}
      </Content>
    </a>
  );
}
