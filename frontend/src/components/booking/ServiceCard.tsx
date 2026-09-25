import { useTranslation } from 'react-i18next';
import { NailArt } from '@/components/brand/NailArt';
import { AddIcon, CheckIcon, ScheduleIcon } from '@/components/ui/icons';
import { useI18nText } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { formatDuration, formatPrice } from '@/lib/format';
import type { SwatchColor } from '@/lib/swatch';
import { SWATCH } from '@/lib/swatch';
import type { Service } from '@/types/api';

interface ServiceCardProps {
  service: Service;
  color: SwatchColor;
  currency: string;
  selected?: boolean;
  onToggle?: (service: Service) => void;
}

/** One service: swatch thumbnail, name, 2-line description, time and price, add toggle. */
export function ServiceCard({ service, color, currency, selected, onToggle }: ServiceCardProps) {
  const { t } = useTranslation(['booking', 'common']);
  const tr = useI18nText();
  const name = tr(service.name);
  const interactive = Boolean(onToggle);

  const body = (
    <>
      <span className={cx('flex size-20 shrink-0 items-center justify-center rounded-lg', SWATCH[color].field)}>
        <NailArt art={service.art} color={color} className="w-[4.5rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold leading-snug text-ink-900">{name}</span>
        {tr(service.description) ? (
          <span className="mt-1 line-clamp-2 block text-sm leading-snug text-ink-600">{tr(service.description)}</span>
        ) : null}
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1 text-ink-600">
            <ScheduleIcon fontSize="inherit" className="text-base" />
            {formatDuration(t, service.durationMin)}
          </span>
          <span className="tabular font-bold text-rose-700">{formatPrice(t, service.price, currency, service.priceFrom)}</span>
        </span>
      </span>
      {interactive ? (
        <span
          aria-hidden="true"
          className={cx(
            'mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-pill text-[1.35rem] transition-colors duration-200',
            selected ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-900 group-hover:bg-ink-100',
          )}
        >
          {selected ? <CheckIcon fontSize="inherit" /> : <AddIcon fontSize="inherit" />}
        </span>
      ) : null}
    </>
  );

  if (!interactive) {
    return <div className="flex items-start gap-4 rounded-xl p-3">{body}</div>;
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={selected ? t('services.remove', { name }) : t('services.add', { name })}
      onClick={() => onToggle?.(service)}
      className={cx(
        'group press flex w-full items-start gap-4 rounded-xl p-3 text-left transition-[background-color,box-shadow]',
        selected ? 'bg-blush-50 ring-2 ring-ink-900' : 'hover:bg-ink-50',
      )}
    >
      {body}
    </button>
  );
}
