import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { CategoryChips } from '@/components/booking/CategoryChips';
import { NailShapePicker } from '@/components/booking/NailShapePicker';
import { PhotoPicker } from '@/components/booking/PhotoPicker';
import { SelectionBar } from '@/components/booking/SelectionBar';
import { ServiceList } from '@/components/booking/ServiceList';
import { useBookingPhotos } from '@/components/booking/useBookingPhotos';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCatalog, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { bringIntoView } from '@/lib/scroll';
import { toggleService } from '@/lib/selection';
import type { NailShape, Service } from '@/types/api';

/**
 * Browse the menu and pick one or more services; the summary bar starts the booking. Every
 * service ends with the nails filed to a shape, so the shape is asked at the top (as on the
 * booking's first step), and Continue won't go on without one. Photos of the nails the client
 * wants can be added here too; they go on with the booking (useBookingPhotos).
 */
export default function ServicesPage() {
  const { t } = useTranslation(['booking', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { currency } = useStudio();
  const [selected, setSelected] = useState<string[]>([]);
  const [shape, setShape] = useState<NailShape | null>(null);
  const [shapeAsked, setShapeAsked] = useState(false);
  const picker = useRef<HTMLElement>(null);
  const { user } = useAuth();
  const photos = useBookingPhotos(user?.id ?? null);

  const toggle = (service: Service) => setSelected((ids) => toggleService(ids, service, catalog));

  const chosen = selected.map((id) => catalog.byId.get(id)).filter((s): s is Service => Boolean(s));
  const durationMin = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.price, 0);

  const book = () => {
    if (!shape) {
      // Go back up to the shapes and put focus there, so a screen reader hears the message.
      setShapeAsked(true);
      const section = picker.current;
      if (!section) return;
      bringIntoView(section);
      section
        .querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
        ?.focus({ preventScroll: true });
      return;
    }
    const params = new URLSearchParams({ services: selected.join(','), shape });
    navigate(`${lp('/book')}?${params.toString()}`);
  };

  return (
    <div className={chosen.length > 0 ? 'pb-28' : undefined}>
      <PageHeader title={t('services.title')} subtitle={t('services.subtitle')} />
      <div className="gutter-x mt-5 lg:px-0">
        <NailShapePicker
          ref={picker}
          value={shape}
          onChange={(next) => {
            setShape(next);
            setShapeAsked(false);
          }}
          invalid={shapeAsked && !shape}
        />
        {/* The demo account books nothing, so it sends no photos either (as on the booking). */}
        {user?.isDemo ? null : <PhotoPicker className="mt-8" photos={photos.photos} onAdd={photos.add} onRemove={photos.remove} />}
      </div>
      {catalog.categories.length > 0 ? (
        <CategoryChips
          categories={catalog.grouped.map((g) => g.category)}
          className="sticky top-0 z-30 mt-6 bg-white lg:top-18"
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
          onAction={book}
        />
      ) : null}
    </div>
  );
}
