import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { ChevronRightIcon, ExpandMoreIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { adminQueries } from '../api';
import { RequestList } from './RequestList';

/** The oldest requests the card shows before "See all" (two of them on phones). */
const FIRST = 3;

/**
 * The top of "Today" while clients wait for an answer: how many, the oldest ones with their
 * quick answers, and "See all" opening the whole list in place (?requests=all, which is also
 * where the "New requests" sheet leads). Peach, the colour of a request across the staff app.
 */
export function PendingRequestsCard({ withMaster }: { withMaster: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const pending = useQuery(adminQueries.pendingRequests());

  if (pending.isError && !pending.data) return <Alert>{errorMessage(t, pending.error)}</Alert>;
  if (!pending.data || pending.data.total === 0) return null;

  const { appointments, total, scope } = pending.data;
  const all = params.get('requests') === 'all';
  const next = new URLSearchParams(params);
  if (all) next.delete('requests');
  else next.set('requests', 'all');
  const search = next.toString();

  return (
    <section
      aria-labelledby="requests-title"
      className="rounded-2xl bg-peach-50 p-4 ring-1 ring-inset ring-peach-100 sm:p-5"
    >
      <div className="px-1">
        <h2 id="requests-title" className="flex items-center gap-2 text-h2 font-extrabold">
          {t('dashboard.requests')}
          <span className="tabular inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-pill bg-peach-500 px-2 text-[0.9375rem] font-extrabold text-ink-900">
            {total}
          </span>
        </h2>
        <p className="mt-1 text-sm text-peach-800">{t('dashboard.requestsHint')}</p>
      </div>
      <RequestList
        requests={all ? appointments : appointments.slice(0, FIRST)}
        withMaster={withMaster && scope === 'all'}
        tone="peach"
        className={cx('mt-4 px-1', !all && 'max-md:[&>li:nth-child(3)]:hidden')}
      />
      {total > 2 ? (
        <Link
          to={{ pathname, search: search ? `?${search}` : '' }}
          replace
          preventScrollReset
          // Wider screens show three, so there a third request needs no "See all".
          className={cx(
            'press group/all mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-xl text-[0.9375rem] font-semibold text-ink-900 hover:bg-peach-100',
            !all && total <= FIRST && 'md:hidden',
          )}
        >
          {all ? t('requests.showFewer') : t('requests.seeAll', { n: total })}
          {all ? (
            <ExpandMoreIcon fontSize="inherit" className="rotate-180 text-xl" />
          ) : (
            <ChevronRightIcon
              fontSize="inherit"
              className="text-xl transition-transform duration-200 ease-(--ease-out) group-hover/all:translate-x-0.5"
            />
          )}
        </Link>
      ) : null}
    </section>
  );
}
