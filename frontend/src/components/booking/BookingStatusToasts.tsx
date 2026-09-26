import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from '@/components/ui';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatDateTime } from '@/lib/format';
import { queries } from '@/services/queries';

/**
 * While the app is open: a banner when the studio confirms or moves one of the client's visits
 * (the list refreshes every 30 s, and at once when a push arrives), so the change shows without
 * a restart. The phone's own notification carries the sound.
 */
export function BookingStatusToasts() {
  const { t } = useTranslation('booking');
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const navigate = useNavigate();
  const upcoming = useQuery(queries.appointments('upcoming'));
  const known = useRef<Map<string, { status: string; start: string }> | null>(null);

  useEffect(() => {
    if (!upcoming.data) return;
    const before = known.current;
    known.current = new Map(upcoming.data.map((a) => [a.id, { status: a.status, start: a.start }]));
    if (!before) return;
    for (const a of upcoming.data) {
      const was = before.get(a.id);
      if (!was) continue;
      const confirmed = was.status === 'pending' && a.status === 'confirmed';
      const moved = was.start !== a.start;
      if (!confirmed && !moved) continue;
      const master = a.staff ? ` · ${t('live.with', { name: a.staff.name })}` : '';
      toast.success(t(confirmed ? 'live.confirmed' : 'live.moved'), {
        id: `visit-live-${a.id}`,
        description: `${formatDateTime(a.start, locale, timeZone)}${master}`,
        duration: 10_000,
        action: { label: t('live.view'), onClick: () => void navigate(lp(`/bookings/${a.id}`)) },
      });
    }
  }, [upcoming.data, t, locale, timeZone, navigate, lp]);

  return null;
}
