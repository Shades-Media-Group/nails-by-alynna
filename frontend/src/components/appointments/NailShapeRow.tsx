import { useTranslation } from 'react-i18next';
import type { NailShape } from '@/types/api';

/**
 * "Nail shape · Almond" at the top of a visit's services (the client's booking and the desk's),
 * when the client gave one; older bookings have none and show nothing.
 */
export function NailShapeRow({ shape }: { shape: NailShape | null | undefined }) {
  const { t } = useTranslation('booking');
  if (!shape) return null;
  return (
    <dl className="flex items-baseline justify-between gap-3 border-b border-ink-100 px-4 py-3">
      <dt className="text-sm text-ink-600">{t('shape.title')}</dt>
      <dd className="text-[0.9375rem] font-semibold">{t(`shape.${shape}`)}</dd>
    </dl>
  );
}
