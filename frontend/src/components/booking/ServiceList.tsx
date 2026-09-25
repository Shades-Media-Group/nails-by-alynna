import { useTranslation } from 'react-i18next';
import { EmptyState, Skeleton } from '@/components/ui';
import { SpaIcon } from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import type { Service } from '@/types/api';
import { sectionId } from './CategoryChips';
import { ServiceCard } from './ServiceCard';

/** All published services grouped by category, each toggleable. */
export function ServiceList({ selected, onToggle }: { selected: string[]; onToggle: (service: Service) => void }) {
  const { t } = useTranslation('booking');
  const pick = useI18nText();
  const catalog = useCatalog();
  const { currency } = useStudio();

  if (catalog.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} rounded="xl" className="h-28" />
        ))}
      </div>
    );
  }
  if (catalog.grouped.length === 0) return <EmptyState icon={SpaIcon} title={t('services.empty')} />;

  return (
    <div className="flex flex-col gap-8">
      {catalog.grouped.map(({ category, services }) => (
        <section key={category.id} id={sectionId(category.id)} aria-labelledby={`${sectionId(category.id)}-title`} className="scroll-mt-40">
          <h2 id={`${sectionId(category.id)}-title`} className="px-3 text-h3 font-extrabold">
            {pick(category.name)}
          </h2>
          {category.description && pick(category.description) ? (
            <p className="mt-1 max-w-prose px-3 text-sm text-ink-600">{pick(category.description)}</p>
          ) : null}
          <div className="mb-2" />
          <div className="flex flex-col gap-1">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                color={category.color}
                currency={currency}
                selected={selected.includes(service.id)}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
