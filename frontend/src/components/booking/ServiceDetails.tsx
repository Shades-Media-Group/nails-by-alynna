import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RealisticNailArt } from '@/components/brand/nails/RealisticNailArt';
import { Button, Sheet } from '@/components/ui';
import { AddIcon, RemoveIcon, ScheduleIcon } from '@/components/ui/icons';
import { useI18nText } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { formatDuration, formatPrice } from '@/lib/format';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import type { Service } from '@/types/api';

/** Time and price of a service, the same on its row and in its details sheet. */
export function ServiceMeta({ service, currency, className }: { service: Service; currency: string; className?: string }) {
  const { t } = useTranslation(['booking', 'common']);
  return (
    <span className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', className)}>
      <span className="inline-flex items-center gap-1 text-ink-600">
        <ScheduleIcon fontSize="inherit" className="text-base" />
        {formatDuration(t, service.durationMin)}
      </span>
      <span className="tabular font-bold text-rose-700">{formatPrice(t, service.price, currency, service.priceFrom)}</span>
    </span>
  );
}

/** The studio's plain text as paragraphs: a blank line starts one, a single line break stays inside it. */
function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

interface ServiceDetailsSheetProps {
  service: Service;
  color: SwatchColor;
  currency: string;
  selected?: boolean;
  /** The row's add/remove; without it the sheet only tells. */
  onToggle?: (service: Service) => void;
  onClose: () => void;
}

/**
 * "About the procedure": what the studio wrote about a service, under its tile, time and price,
 * with the same add/remove as the row's +. Rendered only while open, like the admin editors.
 */
export function ServiceDetailsSheet({ service, color, currency, selected = false, onToggle, onClose }: ServiceDetailsSheetProps) {
  const { t } = useTranslation(['booking', 'common']);
  const pick = useI18nText();
  const name = pick(service.name);
  // Said to screen readers after the button is used (its new label alone is not always read).
  const [status, setStatus] = useState('');

  const toggle = () => {
    onToggle?.(service);
    setStatus(t(selected ? 'services.details.removed' : 'services.details.added', { name }));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={name}
      footer={
        onToggle ? (
          <Button fullWidth variant={selected ? 'outline' : 'primary'} icon={selected ? RemoveIcon : AddIcon} onClick={toggle}>
            {selected ? t('services.details.remove') : t('services.details.add')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4">
        <span className={cx('flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[color].field)}>
          <RealisticNailArt art={service.art} color={color} className="w-[4.5rem]" />
        </span>
        <ServiceMeta service={service} currency={currency} className="min-w-0" />
      </div>
      <div className="mt-5 flex max-w-[62ch] flex-col gap-3">
        {paragraphs(pick(service.details)).map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line break-words text-[0.9375rem] leading-relaxed text-ink-700">
            {paragraph}
          </p>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </Sheet>
  );
}
