import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useAuth } from '@/app/auth';
import { Button, ButtonLink, Sheet, toast } from '@/components/ui';
import { splitLocale } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { adminQueries } from '../api';
import { pendingSheet, usePendingSheetState } from './openings';
import { RequestList } from './RequestList';
import { useSheetTurn } from './useSheetTurn';

/** Requests the sheet lists; "See all" leads to the rest. */
const FIRST = 6;

/**
 * "New requests (N)": each time the staff app opens (see openings.ts) with requests waiting
 * for this person, the oldest come up in a sheet with their quick answers. It waits for any
 * other sheet on screen, and stays away when the app opened on a booking (a notification's).
 * "Later" puts it away until the next opening; answering the last request closes it.
 */
export function PendingRequestsSheet() {
  const { t } = useTranslation(['admin', 'common']);
  const { user } = useAuth();
  const { lp } = useLocale();
  const { pathname } = useLocation();
  const sheet = usePendingSheetState();
  const pending = useQuery(adminQueries.pendingRequests());
  const staff = useQuery(adminQueries.staff());

  const key = user ? `${user.id}#${sheet.opening}` : null;
  const count = pending.data?.total ?? 0;
  // Only requests fetched since this opening decide, not what was on screen before it.
  const fresh = pending.isSuccess && pending.dataUpdatedAt >= sheet.openedAt;
  const onBooking = /^\/admin\/appointments\//.test(splitLocale(pathname).rest);
  const deciding = key !== null && !sheet.showing && sheet.done !== key && fresh;

  // Nothing waiting, or the app opened on a booking: nothing to show this time.
  useEffect(() => {
    if (key && deciding && (count === 0 || onBooking)) pendingSheet.finish(key);
  }, [key, deciding, count, onBooking]);

  useSheetTurn(deciding && count > 0 && !onBooking ? key : null, pendingSheet.show);

  // All answered (here, or by someone else meanwhile): the sheet goes, and says so.
  useEffect(() => {
    if (!key || !sheet.showing || !pending.isSuccess || count > 0) return;
    pendingSheet.finish(key);
    toast.success(t('requests.allDone'), { duration: 2500 });
  }, [key, sheet.showing, pending.isSuccess, count, t]);

  useEffect(() => pendingSheet.hide, []);

  const close = () => {
    if (key) pendingSheet.finish(key);
  };
  const more = count > FIRST;
  const multiMaster = (staff.data ?? []).filter((s) => s.isActive && s.isBookable).length > 1;

  return (
    <Sheet
      open={sheet.showing}
      onClose={close}
      title={t('requests.title', { n: count })}
      description={t('dashboard.requestsHint')}
      footer={
        <div className={cx('grid gap-2', more && 'grid-cols-2')}>
          <Button variant="soft" size="md" onClick={close}>
            {t('requests.later')}
          </Button>
          {more ? (
            <ButtonLink to={lp('/admin?requests=all')} variant="outline" size="md" onClick={close}>
              {t('requests.seeAll', { n: count })}
            </ButtonLink>
          ) : null}
        </div>
      }
    >
      {pending.data ? (
        <RequestList
          requests={pending.data.appointments.slice(0, FIRST)}
          withMaster={multiMaster && pending.data.scope === 'all'}
          onOpen={close}
          className="py-1"
        />
      ) : null}
    </Sheet>
  );
}
