import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui';
import { useI18nText } from '@/hooks/useStudio';
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
  const bar = useRef<HTMLDivElement>(null);
  // While a tapped chip scrolls the page, the scroll-spy must not fight it.
  const scrolling = useRef(false);
  const unlockTimer = useRef<number | undefined>(undefined);

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
    return () => {
      observer.disconnect();
      window.clearTimeout(unlockTimer.current);
    };
  }, [categories]);

  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const go = (id: string) => {
    setActive(id);
    scrolling.current = true;
    window.clearTimeout(unlockTimer.current);
    unlockTimer.current = window.setTimeout(() => {
      scrolling.current = false;
    }, 800);
    const target = document.getElementById(sectionId(id));
    if (!target) return;
    const offset = window.matchMedia('(min-width: 64rem)').matches ? 160 : 90;
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
  };

  return (
    <div className={className}>
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
