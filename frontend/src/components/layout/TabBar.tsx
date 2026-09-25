import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cx } from '@/lib/cx';
import { useClientNav } from './nav';

/**
 * Floating ink pill at thumb height (Figma home menu, refined): the active tab expands into a
 * blush chip with its label; the others stay icon-only but keep accessible names.
 */
export function TabBar() {
  const { t } = useTranslation('common');
  const items = useClientNav();
  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+0.75rem)] z-40 flex justify-center px-4 lg:hidden"
    >
      <ul className="flex items-center gap-1 rounded-pill bg-ink-900 p-1.5 shadow-float">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              aria-label={item.label}
              className={({ isActive }) =>
                cx(
                  'press group flex h-12 items-center justify-center rounded-pill text-[1.45rem] transition-[background-color,padding,color] duration-300 ease-(--ease-out)',
                  isActive ? 'bg-blush-100 px-4 text-ink-900' : 'w-12 text-white/70 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon fontSize="inherit" />
                  <span
                    className={cx(
                      'overflow-hidden whitespace-nowrap text-sm font-semibold transition-[max-width,margin,opacity] duration-300 ease-(--ease-out)',
                      isActive ? 'ml-2 max-w-32 opacity-100' : 'ml-0 max-w-0 opacity-0',
                    )}
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
