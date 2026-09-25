import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui';
import { useI18nText } from '@/hooks/useStudio';
import { centerInStrip, scrollPageTo } from '@/lib/scroll';
import type { Category } from '@/types/api';

export const sectionId = (categoryId: string) => `category-${categoryId}`;

/**
 * Sticky category chips with scroll-spy: the chip of the section in view is highlighted,
 * and tapping a chip scrolls to its section.
 */
export function CategoryChips({ categories, className }: { categories: Category[]; className?: string }) {
  const { t } = useTranslation('booking');
  const pick = useI18nText();
  const [active, setActive] = useState(categories[0]?.id ?? '');
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // While a tapped chip scrolls the page, the scroll-spy must not fight it.
  const scrolling = useRef(false);

  useEffect(() => {
    const sections = categories
      .map((c) => document.getElementById(sectionId(c.id)))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrolling.current) return;
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id.replace('category-', '');
        if (id) setActive(id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [categories]);

  // Keep the active chip in view by scrolling the chip row only — never the page, which would
  // cut a flick short on iOS.
  useEffect(() => {
    const strip = bar.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (strip && chip) centerInStrip(strip, chip);
  }, [active]);

  const go = (id: string) => {
    setActive(id);
    const target = document.getElementById(sectionId(id));
    if (!target) return;
    // Land the section just under the stuck chip row, whatever its height on this screen.
    const sticky = root.current;
    const stuckAt = sticky ? parseFloat(getComputedStyle(sticky).top) || 0 : 0;
    const offset = stuckAt + (sticky?.offsetHeight ?? 0) + 8;
    scrolling.current = true;
    scrollPageTo(target.getBoundingClientRect().top + window.scrollY - offset, () => {
      scrolling.current = false;
    });
  };

  return (
    <div ref={root} className={className}>
      <div
        ref={bar}
        role="toolbar"
        aria-label={t('services.categories')}
        className="no-scrollbar flex gap-2 overflow-x-auto px-[var(--gutter)] py-3 lg:px-0"
      >
        {categories.map((category) => (
          <Chip key={category.id} data-id={category.id} selected={category.id === active} onClick={() => go(category.id)}>
            {pick(category.name)}
          </Chip>
        ))}
      </div>
    </div>
  );
}
