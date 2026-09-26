import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { toast } from '@/components/ui';
import { useI18nText } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { listenForTaps, playChime } from '@/lib/chime';
import { addDays, formatDateTime, fullName } from '@/lib/format';
import { readPushState } from '@/lib/push';
import { adminQueries } from '../api';
import { useStudioToday } from './hooks';

/**
 * While the staff app is open: a chime and a banner when a client books or asks for a visit.
 * The list refreshes every 30 s, and at once when a push arrives; bookings already there when
 * the app opened are not announced. The chime stays quiet on a device with notifications on,
 * since the phone plays its own sound for the push.
 */
export function BookingAlerts() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const { lp, locale } = useLocale();
  const navigate = useNavigate();
  const pick = useI18nText();
  const { today, timeZone } = useStudioToday();
  const list = useQuery(adminQueries.appointments({ from: today, to: addDays(today, 60) }));
  const seen = useRef<Set<string> | null>(null);
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => listenForTaps(), []);
  useEffect(() => {
    if (!user) return;
    void readPushState(user.id).then((state) => setPushOn(state === 'on'));
  }, [user]);

  useEffect(() => {
    if (!list.data) return;
    const booked = list.data.filter(
      (a) => a.source === 'client' && (a.status === 'pending' || a.status === 'confirmed'),
    );
    if (seen.current === null) {
      seen.current = new Set(booked.map((a) => a.id));
      return;
    }
    const known = seen.current;
    const arrivals = booked.filter((a) => !known.has(a.id));
    if (arrivals.length === 0) return;
    arrivals.forEach((a) => known.add(a.id));
    if (!pushOn) playChime();
    for (const a of arrivals) {
      toast(t(a.status === 'pending' ? 'alerts.request' : 'alerts.booking'), {
        id: `booking-alert-${a.id}`,
        description: `${fullName(a.client)} · ${formatDateTime(a.start, locale, timeZone)} · ${a.services.map((s) => pick(s.name)).join(', ')}`,
        duration: 12_000,
        action: {
          label: t('alerts.open'),
          onClick: () => void navigate(lp(`/admin/appointments/${a.id}`)),
        },
      });
    }
  }, [list.data, pushOn, t, locale, timeZone, pick, navigate, lp]);

  return null;
}
