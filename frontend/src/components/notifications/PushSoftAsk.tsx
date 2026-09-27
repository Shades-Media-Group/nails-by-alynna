import NotificationsOffIcon from '@mui/icons-material/NotificationsOffRounded';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, STAFF_ROLES } from '@/app/auth';
import { Button } from '@/components/ui';
import { useStudio } from '@/hooks/useStudio';
import { InstallIcon, NotificationsIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { softAskFor } from '@/lib/push';
import type { NotificationPrefsPatch } from '@/services/api/endpoints';
import { blockedHint, onPhone } from './pushDevice';
import { useTurnOnPush } from './useTurnOnPush';

/**
 * The gentle ask for notifications, after a booking and at the top of Profile → Notifications:
 * a small card with one button while a tap can still turn them on; one line saying what to do
 * when only the phone can (add the app to the Home Screen, allow notifications again); nothing
 * when they are on or can't work here (see softAskFor).
 */
export function PushSoftAsk({
  placement,
  booked = false,
  className,
}: {
  placement: 'booking' | 'settings';
  /** After booking: the visit is already confirmed, so the promise is the reminder. */
  booked?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['push', 'common']);
  const { lp } = useLocale();
  const { user } = useAuth();
  const { device, busy, turnOn, settings } = useTurnOnPush();
  const studio = useStudio();
  const titleId = useId();
  const ask = user && !user.isDemo ? softAskFor(device) : null;
  if (!ask) return null;

  if (ask === 'install') {
    return (
      <HintLine icon={<InstallIcon fontSize="inherit" />} className={className}>
        {t('hint.install')}{' '}
        <Link to={lp('/app')} className="font-semibold text-ink-900 underline underline-offset-2">
          {t('hint.installLink')}
        </Link>
      </HintLine>
    );
  }
  if (ask === 'blocked') {
    return (
      <HintLine icon={<NotificationsOffIcon fontSize="inherit" />} className={className}>
        {blockedHint(t)}
      </HintLine>
    );
  }

  const staff = STAFF_ROLES.includes(user!.role);
  // "When the master confirms" only where the master confirms: a request waiting after booking,
  // or a studio that approves bookings; else the promise is the reminder.
  const confirms =
    placement === 'booking' ? !booked : studio.data?.booking.requireApproval === true;
  const title = staff
    ? t('softAsk.staffTitle')
    : confirms
      ? t('softAsk.title')
      : t('softAsk.titleBooked');
  const text = staff
    ? t('softAsk.staffText')
    : onPhone()
      ? t('softAsk.textPhone')
      : t('softAsk.textDevice');
  // After booking, the promise is about this visit's updates: make sure they come by app too.
  const bookingUpdatesOff = settings.data ? !settings.data.prefs.bookingUpdates.push : false;
  const patch: NotificationPrefsPatch | undefined =
    placement === 'booking' && bookingUpdatesOff ? { bookingUpdates: { push: true } } : undefined;

  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        'rounded-2xl bg-white p-4 text-left ring-1 ring-inset ring-ink-100 sm:p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-blush-100 text-[1.35rem] text-ink-800"
          aria-hidden="true"
        >
          <NotificationsIcon fontSize="inherit" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[0.9375rem] font-semibold text-ink-900">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-ink-600">{text}</p>
          <Button
            variant={placement === 'settings' ? 'primary' : 'soft'}
            size="md"
            className="mt-3"
            loading={busy}
            // Straight from the tap: Safari shows the permission prompt only for a user gesture.
            onClick={() => void turnOn(patch)}
          >
            {t('softAsk.action')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function HintLine({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx('flex items-start gap-2 text-left text-sm text-ink-600', className)}>
      <span className="mt-0.5 shrink-0 text-base text-ink-500" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
