import { memo, type ReactNode, type SVGProps } from 'react';

/**
 * Drop-in replacement for `@mui/material/SvgIcon` (aliased in vite.config.ts/tsconfig).
 *
 * We use MUI's free Rounded icon set (`@mui/icons-material/*Rounded`). Each icon module only
 * calls `createSvgIcon(path, name)`; providing that here gives us the exact MUI artwork
 * without shipping @mui/material + emotion (~35 kB gzipped) to every client.
 */

export interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  titleAccess?: string;
  /** Kept for API compatibility with MUI; sizes map to 1em-based sizes. */
  fontSize?: 'inherit' | 'small' | 'medium' | 'large';
  children?: ReactNode;
}

const SIZES = { inherit: '1em', small: '1.25rem', medium: '1.5rem', large: '2.1875rem' } as const;

function SvgIcon({ titleAccess, fontSize = 'medium', children, style, ...rest }: SvgIconProps) {
  const size = SIZES[fontSize];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      aria-hidden={titleAccess ? undefined : true}
      role={titleAccess ? 'img' : undefined}
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      {titleAccess ? <title>{titleAccess}</title> : null}
      {children}
    </svg>
  );
}

export type IconComponent = ((props: SvgIconProps) => ReactNode) & { muiName?: string };

export function createSvgIcon(path: ReactNode, displayName: string): IconComponent {
  const Icon = memo((props: SvgIconProps) => <SvgIcon {...props}>{path}</SvgIcon>);
  Icon.displayName = `${displayName}Icon`;
  return Icon as unknown as IconComponent;
}

export default SvgIcon;
