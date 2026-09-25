import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { AppointmentCard } from '@/components/appointments/AppointmentCard';
import { Alert } from '@/components/common/Alert';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink, EmptyState, SegmentedControl, Skeleton } from '@/components/ui';
import { AddIcon, CalendarIcon, HistoryIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { queries } from '@/services/queries';

type Tab = 'upcoming' | 'past';

/** Upcoming and past visits; the tab lives in the URL so back returns to the same list. */
export default function AppointmentsPage() {
  const { t } = useTranslation(['account', 'common']);
  const { lp } = useLocale();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'past' ? 'past' : 'upcoming';
  const upcoming = useQuery(queries.appointments('upcoming'));
  const past = useQuery({ ...queries.appointments('past'), enabled: tab === 'past' });
  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="pb-6">
      <PageHeader
        title={t('bookings.title')}
        actions={
          <ButtonLink to={lp('/book')} size="sm" icon={AddIcon}>
            {t('bookings.book')}
          </ButtonLink>
        }
      />
      <div className="gutter-x mt-4 lg:px-0">
        <SegmentedControl<Tab>
          label={t('bookings.title')}
          value={tab}
          onChange={(value) => setParams(value === 'past' ? { tab: 'past' } : {}, { replace: true })}
          options={[
            { value: 'upcoming', label: t('bookings.upcoming'), count: upcoming.data?.length },
            { value: 'past', label: t('bookings.past') },
          ]}
        />

        <div key={tab} className="mt-4 flex flex-col gap-2 animate-page">
          {list.isPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} rounded="xl" className="h-20" />)
          ) : list.isError ? (
            <Alert>{errorMessage(t, list.error)}</Alert>
          ) : list.data.length === 0 ? (
            tab === 'upcoming' ? (
              <EmptyState
                icon={CalendarIcon}
                title={t('bookings.emptyUpcomingTitle')}
                description={t('bookings.emptyUpcomingText')}
                action={
                  <ButtonLink to={lp('/book')} size="md">
                    {t('common:actions.bookNow')}
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState icon={HistoryIcon} tone="lilac" title={t('bookings.emptyPastTitle')} description={t('bookings.emptyPastText')} />
            )
          ) : (
            <ul className="flex flex-col gap-2">
              {list.data.map((appointment, index) => (
                <li key={appointment.id} className="stagger" style={{ ['--i' as string]: Math.min(index, 8) }}>
                  <AppointmentCard appointment={appointment} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
