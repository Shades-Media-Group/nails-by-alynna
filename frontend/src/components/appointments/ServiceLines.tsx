import { useTranslation } from 'react-i18next';
import { useI18nText } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import type { Appointment } from '@/types/api';

/**
 * The services of a visit, one per line, so a line break never lands in the middle of the
 * next service's name. Long lists end with "+2 more".
 */
export function ServiceLines({ appointment, max = 3, className }: { appointment: Appointment; max?: number; className?: string }) {
  const { t } = useTranslation('booking');
  const pick = useI18nText();
  const names = appointment.services.map((service) => pick(service.name));
  const shown = names.length > max ? names.slice(0, max - 1) : names;
  const more = names.length - shown.length;
  return (
    <ul className={cx('flex flex-col', className)}>
      {shown.map((name, index) => (
        <li key={index} className="[text-wrap:pretty]">
          {name}
        </li>
      ))}
      {more > 0 ? <li>{t('flow.moreServices', { count: more })}</li> : null}
    </ul>
  );
}
