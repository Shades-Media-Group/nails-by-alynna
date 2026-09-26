import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { CategoryChips } from '@/components/booking/CategoryChips';
import { NailShapePicker } from '@/components/booking/NailShapePicker';
import { SelectionBar } from '@/components/booking/SelectionBar';
import { ServiceList } from '@/components/booking/ServiceList';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Sheet } from '@/components/ui';
import { ArrowForwardIcon } from '@/components/ui/icons';
import { useCatalog, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { toggleService } from '@/lib/selection';
import type { NailShape, Service } from '@/types/api';

/**
 * Browse the menu and pick one or more services; the summary bar starts the booking. Every
 * service ends with the nails filed to a shape, so Continue asks for it first (in a sheet) and
 * won't go on without one.
 */
export default function ServicesPage() {
  const { t } = useTranslation(['booking', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { currency } = useStudio();
  const [selected, setSelected] = useState<string[]>([]);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [shape, setShape] = useState<NailShape | null>(null);
  const [shapeAsked, setShapeAsked] = useState(false);
  const picker = useRef<HTMLElement>(null);

  const toggle = (service: Service) => setSelected((ids) => toggleService(ids, service, catalog));

  const chosen = selected.map((id) => catalog.byId.get(id)).filter((s): s is Service => Boolean(s));
  const durationMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.price, 0);

  const book = () => {
    if (!shape) {
      // Say what's missing and put focus on the shapes, so a screen reader hears it there.
      setShapeAsked(true);
      picker.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
      return;
    }
    const params = new URLSearchParams({ services: selected.join(','), shape });
    navigate(`${lp('/book')}?${params.toString()}`);
  };

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
          onAction={() => setShapeOpen(true)}
        />
      ) : null}
      <Sheet
        open={shapeOpen}
        onClose={() => setShapeOpen(false)}
        title={t('shape.title')}
        hideTitle
        footer={
          <Button variant="primary" fullWidth trailingIcon={ArrowForwardIcon} onClick={book}>
            {t('services.continue')}
          </Button>
        }
      >
        <NailShapePicker
          ref={picker}
          value={shape}
          onChange={(next) => {
            setShape(next);
            setShapeAsked(false);
          }}
          invalid={shapeAsked && !shape}
        />
      </Sheet>
    </div>
  );
}
