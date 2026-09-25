import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { CategoryChips } from '@/components/booking/CategoryChips';
import { SelectionBar } from '@/components/booking/SelectionBar';
import { ServiceList } from '@/components/booking/ServiceList';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCatalog, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { toggleService } from '@/lib/selection';
import type { Service } from '@/types/api';

/** Browse the menu and pick one or more services; the summary bar starts the booking. */
export default function ServicesPage() {
  const { t } = useTranslation(['booking', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { currency } = useStudio();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (service: Service) => setSelected((ids) => toggleService(ids, service, catalog));

  const chosen = selected.map((id) => catalog.byId.get(id)).filter((s): s is Service => Boolean(s));
  const durationMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.price, 0);

  return (
    <div className={chosen.length > 0 ? 'pb-28' : undefined}>
      <PageHeader title={t('services.title')} subtitle={t('services.subtitle')} />
      {catalog.categories.length > 0 ? (
        <CategoryChips
          categories={catalog.grouped.map((g) => g.category)}
          className="sticky top-0 z-30 mt-4 bg-white lg:top-18"
        />
      ) : null}
      <div className="px-[calc(var(--gutter)-0.75rem)] pt-2 lg:px-0">
        <ServiceList selected={selected} onToggle={toggle} />
      </div>
      {chosen.length > 0 ? (
        <SelectionBar
          aboveTabBar
          count={chosen.length}
          durationMin={durationMin}
          price={price}
          priceFrom={chosen.some((s) => s.priceFrom)}
          currency={currency}
          actionLabel={t('services.continue')}
          onAction={() => navigate(`${lp('/book')}?services=${selected.join(',')}`)}
        />
      ) : null}
    </div>
  );
}
