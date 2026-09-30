import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Sheet } from '@/components/ui';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { BookingPhoto } from '@/types/api';

/**
 * The photos a client added to a booking: small tiles, and a tap shows one large (arrows go
 * through the others). Used on the client's booking page and on the staff's.
 */
export function PhotoGallery({ photos, title, className }: { photos: BookingPhoto[]; title: string; className?: string }) {
  const { t } = useTranslation('booking');
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const current = open === null ? null : photos[open];

  return (
    <section className={className} aria-label={title}>
      <h2 className="text-h3 font-bold">{title}</h2>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:max-w-sm">
        {photos.map((photo, index) => (
          <li key={photo.id} className="aspect-square">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={t('photos.open', { n: index + 1 })}
              className="press size-full overflow-hidden rounded-xl bg-ink-50 ring-1 ring-inset ring-ink-100"
            >
              <img src={photo.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={current !== null} onClose={() => setOpen(null)} title={title} hideTitle size="lg">
        {current ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <img
              src={current.url}
              alt={t('photos.alt', { n: (open ?? 0) + 1 })}
              width={current.width}
              height={current.height}
              className="max-h-[70dvh] w-auto max-w-full rounded-xl bg-ink-50 object-contain"
            />
            {photos.length > 1 ? (
              <div className="flex items-center gap-3">
                <IconButton
                  icon={ChevronLeftIcon}
                  variant="soft"
                  label={t('photos.previous')}
                  onClick={() => setOpen(((open ?? 0) + photos.length - 1) % photos.length)}
                />
                <span className="tabular text-sm font-semibold text-ink-700">
                  {(open ?? 0) + 1} / {photos.length}
                </span>
                <IconButton icon={ChevronRightIcon} variant="soft" label={t('photos.next')} onClick={() => setOpen(((open ?? 0) + 1) % photos.length)} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
