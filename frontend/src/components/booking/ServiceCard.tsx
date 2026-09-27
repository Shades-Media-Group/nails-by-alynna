import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RealisticNailArt } from '@/components/brand/nails/RealisticNailArt';
import { AddIcon, CheckIcon, InfoIcon } from '@/components/ui/icons';
import { useI18nText } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import type { SwatchColor } from '@/lib/swatch';
import { SWATCH } from '@/lib/swatch';
import { noOrphan } from '@/lib/typography';
import type { Service } from '@/types/api';
import { ServiceDetailsSheet, ServiceMeta } from './ServiceDetails';

interface ServiceCardProps {
  service: Service;
  color: SwatchColor;
  currency: string;
  selected?: boolean;
  onToggle?: (service: Service) => void;
}

/**
 * One service: swatch thumbnail, name, 2-line description, time and price, add toggle, and an ⓘ
 * under the + when the studio wrote about the procedure (it opens the details sheet).
 */
export function ServiceCard({ service, color, currency, selected, onToggle }: ServiceCardProps) {
  const { t } = useTranslation(['booking', 'common']);
  const tr = useI18nText();
  const name = tr(service.name);
  const interactive = Boolean(onToggle);
  const hasDetails = tr(service.details).trim() !== '';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const infoButton = useRef<HTMLButtonElement>(null);

  const body = (
    <>
      <span className={cx('flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[color].field)}>
        <RealisticNailArt art={service.art} color={color} className="w-[4.5rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-balance text-[0.9375rem] font-bold leading-snug text-ink-900">{noOrphan(name)}</span>
        {tr(service.description) ? (
          <span className="mt-1 line-clamp-2 block text-sm leading-snug text-ink-600">{noOrphan(tr(service.description))}</span>
        ) : null}
        <ServiceMeta service={service} currency={currency} className="mt-2" />
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

  // Next to the row's button, never inside it: a tap here opens the sheet and adds nothing. An
  // 18px glyph in a lighter ink than the +, 6px under it, so the two read as one. The 44px
  // target reaches 8px into the +'s circle; hover and focus draw only a 24px circle round the
  // glyph, which stays clear of the +.
  const aboutLabel = t('services.about', { name });
  const info = hasDetails ? (
    <button
      ref={infoButton}
      type="button"
      aria-label={aboutLabel}
      title={aboutLabel}
      aria-haspopup="dialog"
      onClick={() => setDetailsOpen(true)}
      className={cx(
        'press inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-lg text-ink-500/85 outline-hidden hover:text-ink-900',
        'before:absolute before:inset-2.5 before:rounded-pill before:transition-[background-color] hover:before:bg-ink-100',
        'focus-visible:before:outline-2 focus-visible:before:outline-offset-2 focus-visible:before:outline-rose-600',
        interactive ? 'absolute right-2.5 top-12' : 'relative -mr-1.5 -mt-1',
      )}
    >
      <InfoIcon fontSize="inherit" className="relative" />
    </button>
  ) : null;
  const sheet = detailsOpen ? (
    <ServiceDetailsSheet
      service={service}
      color={color}
      currency={currency}
      selected={selected}
      onToggle={onToggle}
      onClose={() => {
        setDetailsOpen(false);
        // Back to the ⓘ. Safari never focuses a tapped button, so the dialog can't restore it.
        infoButton.current?.focus({ preventScroll: true });
      }}
    />
  ) : null;

  if (!interactive) {
    return (
      <div className="flex items-start gap-4 rounded-xl p-3">
        {body}
        {info}
        {sheet}
      </div>
    );
  }

  return (
    // The row's press shrinks the ⓘ with it, so the two stay aligned; pressing the ⓘ leaves the row still.
    <div className="relative transition-transform duration-180 ease-(--ease-press) has-[>[data-row]:active]:scale-[0.97] has-[>[data-row]:active]:delay-60">
      <button
        type="button"
        data-row=""
        aria-pressed={selected}
        aria-label={selected ? t('services.remove', { name }) : t('services.add', { name })}
        onClick={() => onToggle?.(service)}
        className={cx(
          'group flex w-full items-start gap-4 rounded-xl p-3 text-left transition-[background-color,box-shadow]',
          selected ? 'bg-blush-50 ring-2 ring-ink-900' : 'hover:bg-ink-50',
        )}
      >
        {body}
      </button>
      {info}
      {sheet}
    </div>
  );
}
