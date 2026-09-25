import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/app/auth';
import { NextVisitCard } from '@/components/appointments/NextVisitCard';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { InstallBanner } from '@/components/common/InstallBanner';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Avatar, Button, ButtonAnchor, IconButton, Skeleton } from '@/components/ui';
import {
  ArrowForwardIcon,
  ChatIcon,
  ChevronRightIcon,
  DirectionsIcon,
  LocationIcon,
  ReplayIcon,
  SupportAgentIcon,
} from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { rebookQuery, serviceNames } from '@/lib/appointment';
import { cx } from '@/lib/cx';
import { formatDuration, formatPrice } from '@/lib/format';
import { studioHours, weekdayIn } from '@/lib/hours';
import { SWATCH } from '@/lib/swatch';
import { queries } from '@/services/queries';

/** Entrance order for the staggered rise (see the `stagger` utility). */
const order = (i: number) => ({ '--i': i }) as CSSProperties;

const arrow = 'shrink-0 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1';

export default function HomePage() {
  const { t } = useTranslation(['booking', 'common']);
  const { user } = useAuth();
  const { lp } = useLocale();
  const pick = useI18nText();
  const { timeZone, currency, data: config } = useStudio();
  const upcoming = useQuery(queries.appointments('upcoming'));
  const past = useQuery(queries.appointments('past'));
  const staff = useQuery(queries.staff());
  const catalog = useCatalog();
  const [contactOpen, setContactOpen] = useState(false);

  const next = upcoming.data?.[0];
  const lastVisit = past.data?.find((a) => a.status === 'completed');
  const popular = catalog.services.filter((s) => s.isPopular).slice(0, 8);
  const hours = staff.data ? studioHours(staff.data, weekdayIn(timeZone)) : null;
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

          <div className="stagger" style={order(3)}>
            <InstallBanner />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-6 lg:mt-0">
          {popular.length > 0 ? (
            <section aria-labelledby="popular-title" className="stagger" style={order(4)}>
              <SectionHeading
                id="popular-title"
                title={t('home.popular')}
                action={
                  <Link
                    to={lp('/services')}
                    className="group inline-flex items-center gap-0.5 rounded-pill text-sm font-semibold text-ink-700 hover:text-ink-900"
                  >
                    {t('home.allServices')}
                    <ChevronRightIcon fontSize="inherit" className={cx(arrow, 'text-lg')} />
                  </Link>
                }
              />
              <ul className="no-scrollbar -mx-[var(--gutter)] flex snap-x snap-mandatory scroll-px-[var(--gutter)] gap-2.5 overflow-x-auto px-[var(--gutter)] pb-3 pt-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                {popular.map((service) => {
                  const color = catalog.categoryById.get(service.categoryId)?.color ?? 'blush';
                  return (
                    <li key={service.id} className="w-[9.5rem] shrink-0 snap-start lg:w-auto">
                      <Link
                        to={`${lp('/book')}?services=${service.id}`}
                        className="press lift group flex h-full flex-col rounded-xl bg-white p-2 ring-1 ring-inset ring-ink-100"
                      >
                        <span className={cx('flex h-24 items-center justify-center overflow-hidden rounded-lg', SWATCH[color].field)}>
                          <NailArt
                            art={service.art}
                            color={color}
                            className="w-24 transition-transform duration-500 ease-(--ease-out) group-hover:scale-105"
                          />
                        </span>
                        <span className="mt-2 line-clamp-2 px-1 text-sm font-bold leading-snug">{pick(service.name)}</span>
                        <span className="mt-auto flex items-baseline justify-between gap-2 px-1 pb-0.5 pt-1.5 text-xs">
                          <span className="text-ink-600">{formatDuration(t, service.durationMin)}</span>
                          <span className="tabular text-[0.8125rem] font-bold text-rose-700">
                            {formatPrice(t, service.price, currency, service.priceFrom)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-label={t('home.studio')} className="stagger rounded-2xl bg-ink-50 p-4" style={order(5)}>
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
            <div className="mt-3 flex flex-wrap gap-2 pl-13">
              <Button size="sm" variant="outline" icon={ChatIcon} onClick={() => setContactOpen(true)}>
                {t('home.shortcutContact')}
              </Button>
              {config?.studio.mapsUrl ? (
                <ButtonAnchor size="sm" variant="outline" icon={DirectionsIcon} href={config.studio.mapsUrl} target="_blank" rel="noopener noreferrer">
                  {t('common:contact.directions')}
                </ButtonAnchor>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
