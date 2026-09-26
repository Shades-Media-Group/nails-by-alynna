import NotificationsOffIcon from '@mui/icons-material/NotificationsOffRounded';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { STAFF_ROLES, useAuth } from '@/app/auth';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { notificationsQuery, unblockSteps, usePushDevice } from './pushDevice';

/**
 * Staff app: while notifications are blocked on this device, a compact line at the top says so
 * (new booking requests won't reach them), how to allow them again, and links to the settings.
 * Stays until they are allowed; staff who switched booking notifications off see nothing.
 */
export function PushBlockedBanner({ className }: { className?: string }) {
  const { t } = useTranslation(['push', 'common']);
  const { lp } = useLocale();
  const { user } = useAuth();
  const staff = Boolean(user && !user.isDemo && STAFF_ROLES.includes(user.role));
  const settings = useQuery({ ...notificationsQuery(), enabled: staff });
  const [device] = usePushDevice(staff ? user?.id : undefined, settings.data?.push.available);
  const wanted = settings.data?.prefs.staffBookings.push !== false;
  if (!staff || device !== 'denied' || !wanted) return null;

  return (
    <div
      role="status"
      className={cx(
        'flex items-start gap-2.5 rounded-xl bg-peach-50 px-4 py-3 text-sm text-peach-800',
        className,
      )}
    >
      <NotificationsOffIcon
        fontSize="inherit"
        className="mt-0.5 shrink-0 text-lg"
        aria-hidden="true"
      />
      <p className="min-w-0">
        <span className="font-semibold">{t('banner.staffBlocked')}</span> {unblockSteps(t)}{' '}
        <Link
          to={lp('/profile/notifications')}
          className="whitespace-nowrap font-semibold underline underline-offset-2"
        >
          {t('banner.fix')}
        </Link>
      </p>
    </div>
  );
}
