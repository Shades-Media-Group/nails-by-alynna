import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/components/ui';
import type { AppointmentStatus } from '@/types/api';

const TONE: Record<AppointmentStatus, BadgeTone> = {
  pending: 'peach',
  confirmed: 'mint',
  completed: 'neutral',
  cancelled: 'red',
  no_show: 'red',
};

/** Appointment status in the studio's words (a "request", a "no-show"), not the client's. */
export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  const { t } = useTranslation('admin');
  return (
    <Badge tone={TONE[status]} className={className}>
      {t(`status.${status}`)}
    </Badge>
  );
}
