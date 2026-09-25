import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { cx } from '@/lib/cx';
import { useClientNav } from './nav';

interface Pill {
  x: number;
  width: number;
}

/**
 * Floating ink pill at thumb height (Figma home menu, refined). The active tab opens into a
 * blush chip with its label, and that chip slides from the old tab to the new one instead of
 * blinking between them. The other tabs stay icon-only but keep their accessible names.
 */
export function TabBar() {
  const { t } = useTranslation('common');
  const items = useClientNav();
  const { pathname } = useLocation();
  const listRef = useRef<HTMLUListElement>(null);
  const [pill, setPill] = useState<Pill | null>(null);
  const [animate, setAnimate] = useState(false);

  const activeIndex = items.findIndex((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  // A new array arrives on every render; only its contents matter for measuring.
  const itemsKey = items.map((item) => `${item.to}:${item.label}`).join('|');

  // Where the active tab will end up once its label has opened: every tab before it is a
  // closed 44 px circle, so the position is known before the label transition finishes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) {
      setPill(null);
      return;
    }
    const measure = () => {
      const links = list.querySelectorAll<HTMLElement>('[data-tab]');
      const active = links[activeIndex];
      if (!active) return;
      const label = active.querySelector<HTMLElement>('[data-tab-label]');
      const styles = getComputedStyle(list);
      const gap = parseFloat(styles.columnGap) || 0;
      const padding = parseFloat(styles.paddingLeft) || 0;
      const closed = 44;
      const icon = active.querySelector('svg')?.getBoundingClientRect().width ?? 22;
      const width = Math.round(16 + icon + 8 + (label?.scrollWidth ?? 0) + 16);
      const x = Math.round(padding + activeIndex * (closed + gap));
      setPill((current) => (current && current.x === x && current.width === width ? current : { x, width }));
    };
    measure();
    // Labels change width when the web font arrives or the language switches.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [activeIndex, itemsKey]);

  // No slide on first paint: the chip appears in place, later changes animate.
  useLayoutEffect(() => {
    if (pill && !animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pill, animate]);

  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+0.75rem)] z-40 flex justify-center px-4 lg:hidden"
    >
      <ul ref={listRef} className="relative flex items-center gap-1 rounded-pill bg-ink-900 p-1.5 shadow-float">
        {pill ? (
          <li
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute left-0 top-1.5 h-11 rounded-pill bg-blush-100',
              animate && 'transition-[transform,width] duration-[380ms] ease-(--ease-out)',
            )}
            style={{ transform: `translateX(${pill.x}px)`, width: pill.width }}
          />
        ) : null}
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <li key={item.to} className="relative">
              <Link
                to={item.to}
                data-tab=""
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  'press flex h-11 min-w-11 items-center justify-center rounded-pill text-[1.35rem] transition-[padding,color] duration-[380ms] ease-(--ease-out)',
                  isActive ? 'px-4 text-ink-900' : 'text-white/65 hover:text-white',
                )}
              >
                <item.icon fontSize="inherit" />
                <span
                  data-tab-label=""
                  aria-hidden="true"
                  className={cx(
                    'overflow-hidden whitespace-nowrap text-sm font-semibold transition-[max-width,margin,opacity] duration-[380ms] ease-(--ease-out)',
                    isActive ? 'ml-2 max-w-32 opacity-100' : 'ml-0 max-w-0 opacity-0',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
