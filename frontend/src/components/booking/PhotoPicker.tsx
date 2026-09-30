import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui';
import { AddPhotoIcon, CloseIcon, ErrorIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { preloadPhotoEncoder } from '@/lib/photos';
import { MAX_BOOKING_PHOTOS, type PickedPhoto } from './useBookingPhotos';

/**
 * "Show us the nails you like": up to three photos, optional. A tile per photo (made small on the
 * phone while the client carries on) and one to add more; the phone's own picker opens, with the
 * camera one tap away.
 */
export function PhotoPicker({
  photos,
  onAdd,
  onRemove,
  className,
}: {
  photos: PickedPhoto[];
  onAdd: (files: FileList) => void;
  onRemove: (key: string) => void;
  className?: string;
}) {
  const { t } = useTranslation('booking');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const failed = photos.find((photo) => photo.status === 'error');

  // The encoder loads while the client looks at the page, so the first photo is quick.
  useEffect(() => preloadPhotoEncoder(), []);

  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="text-h3 font-bold">
          {t('photos.title')}
        </h2>
        <span className="shrink-0 text-sm text-ink-500">{t('photos.optional')}</span>
      </div>
      <p className="mt-0.5 text-sm text-ink-600">{t('photos.text', { count: MAX_BOOKING_PHOTOS })}</p>

      <ul className="mt-3 grid grid-cols-3 gap-2 sm:max-w-sm">
        {photos.map((photo, index) => (
          <li key={photo.key} className="relative aspect-square">
            <img
              src={photo.preview}
              alt={t('photos.alt', { n: index + 1 })}
              className={cx(
                'size-full rounded-xl bg-ink-50 object-cover ring-1 ring-inset',
                photo.status === 'error' ? 'ring-2 ring-red-500' : 'ring-ink-100',
                photo.status === 'working' && 'opacity-70',
              )}
            />
            {photo.status === 'working' ? (
              <span className="absolute inset-0 flex items-center justify-center" role="status" aria-label={t('photos.working')}>
                <span className="rounded-pill bg-white/90 p-2 shadow-sm">
                  <Spinner className="size-5" />
                </span>
              </span>
            ) : photo.status === 'error' ? (
              <span className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded-lg bg-white/95 px-1.5 py-1 text-xs font-semibold text-red-700">
                <ErrorIcon fontSize="inherit" className="text-sm" />
                {t('photos.failedShort')}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(photo.key)}
              aria-label={t('photos.remove', { n: index + 1 })}
              className="press absolute -right-1.5 -top-1.5 inline-flex size-8 items-center justify-center rounded-pill bg-ink-900 text-base text-white shadow-[0_2px_6px_rgb(37_39_38/0.3)]"
            >
              <CloseIcon fontSize="inherit" />
            </button>
          </li>
        ))}
        {photos.length < MAX_BOOKING_PHOTOS ? (
          <li className="aspect-square">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="press flex size-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-200 bg-white text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-ink-50"
            >
              <AddPhotoIcon fontSize="inherit" className="text-2xl text-rose-700" />
              {photos.length === 0 ? t('photos.add') : t('photos.addMore')}
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onAdd(event.target.files);
          event.target.value = '';
        }}
      />
      {failed ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {failed.error === 'format' ? t('photos.formatError') : t('photos.uploadError')}
        </p>
      ) : null}
    </section>
  );
}
