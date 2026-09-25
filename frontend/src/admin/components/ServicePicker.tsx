import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NailArt } from '@/components/brand/NailArt';
import { Alert } from '@/components/common/Alert';
import { Skeleton } from '@/components/ui';
import { AddIcon, CheckIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatDuration, formatPrice } from '@/lib/format';
import { toggleService } from '@/lib/selection';
import { SWATCH } from '@/lib/swatch';
import { useBookableCatalog } from './hooks';
import { SearchField } from './SearchField';
import { matches } from './utils';

/**
 * Services grouped by category, compact enough to scan at the desk, with a search for long
 * price lists. A "one option" category (lengths) swaps its choice instead of stacking two.
 */
export function ServicePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { currency } = useStudio();
  const catalog = useBookableCatalog();
  const [term, setTerm] = useState('');
  const name = (text: { ro: string; ru: string; en: string }) => text[locale] || text.ro;

  if (catalog.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} rounded="xl" className="h-40" />
        ))}
      </div>
    );
  }
  if (catalog.isError) return <Alert>{errorMessage(t, catalog.error)}</Alert>;

  const groups = catalog.categories
    .map((category) => ({
      category,
      services: catalog.services.filter(
        (s) => s.categoryId === category.id && (!term.trim() || matches(name(s.name), term) || matches(s.name.ro, term)),
      ),
    }))
    .filter((g) => g.services.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <SearchField label={t('booking.searchServices')} value={term} onChange={setTerm} />
      {groups.length === 0 ? (
        <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">{term.trim() ? t('booking.noServiceMatch') : t('booking.noServices')}</p>
      ) : (
        groups.map(({ category, services }) => (
          <section
            key={category.id}
            aria-labelledby={`pick-${category.id}`}
            className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-ink-100 px-4 py-2.5">
              <h3 id={`pick-${category.id}`} className="text-h3 font-extrabold">
                {name(category.name)}
              </h3>
              {category.singleChoice ? <span className="text-xs font-semibold text-cyan-800">{t('booking.oneOption')}</span> : null}
            </header>
            <ul className="flex flex-col p-1">
              {services.map((service) => {
                const isSelected = selected.includes(service.id);
                return (
                  <li key={service.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onChange(toggleService(selected, service, catalog))}
                      className={cx(
                        'press flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors',
                        isSelected ? 'bg-blush-50' : 'hover:bg-ink-50',
                      )}
                    >
                      <span className={cx('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[category.color].field)}>
                        <NailArt art={service.art} color={category.color} className="w-10" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold leading-snug">{name(service.name)}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-ink-600">
                          <span className="tabular font-semibold text-ink-900">{formatPrice(t, service.price, currency, service.priceFrom)}</span>
                          <span>{formatDuration(t, service.durationMin)}</span>
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cx(
                          'inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-xl transition-colors duration-200',
                          isSelected ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-900',
                        )}
                      >
                        {isSelected ? <CheckIcon fontSize="inherit" /> : <AddIcon fontSize="inherit" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
