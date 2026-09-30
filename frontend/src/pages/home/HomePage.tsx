import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/app/auth';
import { NextVisitCard } from '@/components/appointments/NextVisitCard';
import { VisitHistory } from '@/components/appointments/VisitHistory';
import { FeedbackPrompt } from '@/components/feedback/FeedbackPrompt';
import { LoyaltyTile } from '@/components/loyalty/LoyaltyBits';
import { WalletBanner } from '@/components/loyalty/WalletBanner';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { GetDirections } from '@/components/common/Directions';
import { InstallBanner } from '@/components/common/InstallBanner';
import { Avatar, Button, IconButton, Skeleton } from '@/components/ui';
import {
  ArrowForwardIcon,
  ChatIcon,
  ChevronRightIcon,
  DirectionsIcon,
  LocationIcon,
  ReplayIcon,
  SupportAgentIcon,
} from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { rebookQuery, serviceNames } from '@/lib/appointment';
import { cx } from '@/lib/cx';
import { dateIn, studioHours, weekdayIn } from '@/lib/hours';
import { queries } from '@/services/queries';

/** Entrance order for the staggered rise (see the `stagger` utility). */
const order = (i: number) => ({ '--i': i }) as CSSProperties;

const arrow = 'shrink-0 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1';

export default function HomePage() {
  const { t } = useTranslation(['booking', 'common']);
  const { user } = useAuth();
  const { lp } = useLocale();
  const pick = useI18nText();
  const { timeZone, data: config } = useStudio();
  const upcoming = useQuery(queries.appointments('upcoming'));
  const past = useQuery(queries.appointments('past'));
  const staff = useQuery(queries.staff());
  const [contactOpen, setContactOpen] = useState(false);

  const next = upcoming.data?.[0];
  // The last visit that took place: marked done, or confirmed and over (see VisitHistory).
  const lastVisit = past.data?.find((a) => a.status === 'completed' || a.status === 'confirmed');
  const hours = staff.data ? studioHours(staff.data, weekdayIn(timeZone), dateIn(timeZone)) : null;
  const address = [config?.studio.address, config?.studio.city].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col gap-5 pb-4 pt-[calc(var(--safe-top)+0.75rem)] lg:pt-10">
      <header className="gutter-x flex items-center justify-between lg:hidden">
        <Link to={lp('/home')} aria-label={t('common:brand.name')} className="rounded-md">
          <Logo variant="mark" className="w-[3.75rem]" />
        </Link>
        <div className="flex items-center gap-2">
          <IconButton icon={SupportAgentIcon} label={t('common:contact.title')} variant="soft" size="sm" onClick={() => setContactOpen(true)} />
          {user ? (
            <Link to={lp('/profile')} aria-label={t('common:nav.profile')} className="rounded-pill">
              <Avatar name={user.name} surname={user.surname} size="sm" />
            </Link>
          ) : null}
        </div>
      </header>

      <div className="gutter-x lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12 lg:px-0">
        <div className="flex flex-col gap-3">
          <h1 className="stagger mb-2 text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.03em] lg:text-h1" style={order(0)}>
            <span className="block text-ink-900">{t('home.greeting', { name: user?.name ?? '' })},</span>
            <span className="block text-rose-500">{t('home.greetingLine')}</span>
          </h1>

          <div className="stagger" style={order(1)}>
            {upcoming.isPending ? (
              <Skeleton rounded="xl" className="h-40" />
            ) : next ? (
              <NextVisitCard appointment={next} />
            ) : (
              <Link
                to={lp('/book')}
                className="press lift group flex items-center gap-4 rounded-2xl bg-blush-100 p-4 pr-4"
              >
                <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/70">
                  <NailArt art="gel" color="blush" className="w-12 transition-transform duration-500 ease-(--ease-out) group-hover:-rotate-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.0625rem] font-bold">{t('home.bookTitle')}</span>
                  <span className="block text-sm text-ink-700">{t('home.bookText')}</span>
                </span>
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-lg text-white">
                  <ArrowForwardIcon fontSize="inherit" className={arrow} />
                </span>
              </Link>
            )}
          </div>

          {/* After a completed visit: how was it? (until it is rated or closed) */}
          <FeedbackPrompt className="stagger" style={order(2)} />

          {lastVisit ? (
            <Link
              to={`${lp('/book')}${rebookQuery(lastVisit)}`}
              style={order(2)}
              className="stagger press lift group flex items-center gap-3 rounded-2xl bg-white p-3 pr-4 ring-1 ring-inset ring-ink-100"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-blush-100 text-xl text-rose-700">
                <ReplayIcon fontSize="inherit" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-bold">{t('home.bookAgain')}</span>
                <span className="block truncate text-sm text-ink-600">
                  {t('home.bookAgainText', { services: serviceNames(lastVisit, pick) })}
                </span>
              </span>
              <ChevronRightIcon fontSize="inherit" className={cx(arrow, 'text-xl text-ink-400')} />
            </Link>
          ) : null}

          <LoyaltyTile className="stagger" style={order(3)} />

          <div className="stagger" style={order(3)}>
            <InstallBanner />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-6 lg:mt-0">
          <VisitHistory className="stagger" style={order(4)} />

          <section aria-label={t('home.shortcutStudio')} className="stagger rounded-2xl bg-ink-50 p-4" style={order(5)}>
            <Link to={lp('/studio')} className="group flex items-center gap-3 rounded-lg">
              <span
                className={cx(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl',
                  hours ? 'text-mint-700' : 'text-ink-500',
                )}
              >
                <LocationIcon fontSize="inherit" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-bold">
                  {hours ? t('home.openToday', { time: hours.close }) : t('home.closedToday')}
                </span>
                <span className="block truncate text-sm text-ink-600">{address || t('common:brand.city')}</span>
              </span>
              <ChevronRightIcon fontSize="inherit" className={cx(arrow, 'text-xl text-ink-400')} />
            </Link>
            <div className="mt-4 flex flex-wrap gap-2">
              {/* Google Maps, Apple Maps, Waze or a taxi: the choice opens in a sheet. */}
              <GetDirections>
                {(open) => (
                  <Button size="sm" variant="outline" className="bg-white" icon={DirectionsIcon} onClick={open}>
                    {t('home.gettingThere')}
                  </Button>
                )}
              </GetDirections>
              <Button size="sm" variant="outline" className="bg-white" icon={ChatIcon} onClick={() => setContactOpen(true)}>
                {t('home.shortcutContact')}
              </Button>
            </div>
          </section>

          <WalletBanner className="stagger" style={order(6)} />
        </div>
      </div>

      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
