import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/app/auth';
import { NextVisitCard } from '@/components/appointments/NextVisitCard';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { InstallBanner } from '@/components/common/InstallBanner';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Avatar, IconButton, Skeleton } from '@/components/ui';
import {
  ArrowForwardIcon,
  CalendarIcon,
  ChatIcon,
  LocationIcon,
  ReplayIcon,
  SpaIcon,
  StorefrontIcon,
  SupportAgentIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { rebookQuery, serviceNames } from '@/lib/appointment';
import { cx } from '@/lib/cx';
import { formatDuration, formatPrice } from '@/lib/format';
import { studioHours, weekdayIn } from '@/lib/hours';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import { queries } from '@/services/queries';

function Shortcut({ to, onClick, label, icon: Icon, color }: { to?: string; onClick?: () => void; label: string; icon: IconComponent; color: SwatchColor }) {
  const swatch = SWATCH[color];
  const inner = (
    <>
      <span className={cx('inline-flex size-11 items-center justify-center rounded-pill bg-white/80 text-[1.35rem]', swatch.ink)}>
        <Icon fontSize="inherit" />
      </span>
      <span className={cx('mt-auto flex items-end justify-between gap-2 pt-6 text-[0.9375rem] font-bold leading-tight', swatch.ink)}>
        {label}
        <ArrowForwardIcon fontSize="inherit" className="shrink-0 text-lg opacity-70" />
      </span>
    </>
  );
  const className = cx('press flex min-h-32 flex-col rounded-xl p-4 text-left transition-shadow hover:shadow-card', swatch.field);
  return to ? (
    <Link to={to} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

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
    <div className="flex flex-col gap-9 pb-4 pt-[calc(var(--safe-top)+1rem)] lg:pt-10">
      <div className="gutter-x flex items-center justify-between lg:hidden">
        <Logo variant="mark" className="w-[5.5rem]" />
        <div className="flex items-center gap-2">
          <IconButton icon={SupportAgentIcon} label={t('common:contact.title')} variant="outline" onClick={() => setContactOpen(true)} />
          {user ? (
            <Link to={lp('/profile')} aria-label={t('common:nav.profile')} className="rounded-pill">
              <Avatar name={user.name} surname={user.surname} />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="gutter-x lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 lg:px-0">
        <div className="flex flex-col gap-6">
          <h1 className="text-[2.35rem] font-extrabold leading-[1.02] tracking-[-0.035em] lg:text-display">
            <span className="block text-ink-900">{t('home.greeting', { name: user?.name ?? '' })},</span>
            <span className="block text-rose-500">{t('home.greetingLine')}</span>
          </h1>

          {upcoming.isPending ? (
            <Skeleton rounded="xl" className="h-60" />
          ) : next ? (
            <NextVisitCard appointment={next} />
          ) : (
            <Link
              to={lp('/book')}
              className="press group relative flex min-h-56 flex-col overflow-hidden rounded-2xl bg-blush-100 p-6 transition-shadow hover:shadow-raised"
            >
              <NailArt art="gel" color="blush" className="absolute -right-6 -top-4 w-52 rotate-12 transition-transform duration-500 ease-(--ease-out) group-hover:rotate-6" />
              <span className="relative mt-auto max-w-[70%]">
                <span className="block text-h2 font-extrabold text-ink-900">{t('home.bookTitle')}</span>
                <span className="mt-1 block text-sm text-ink-700">{t('home.bookText')}</span>
              </span>
              <span className="relative mt-5 inline-flex h-12 w-fit items-center gap-2 rounded-pill bg-ink-900 px-5 text-sm font-semibold text-white">
                {t('common:actions.bookNow')}
                <ArrowForwardIcon fontSize="inherit" className="text-lg" />
              </span>
            </Link>
          )}

          {lastVisit ? (
            <Link
              to={`${lp('/book')}${rebookQuery(lastVisit)}`}
              className="press flex items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-inset ring-ink-100 transition-shadow hover:shadow-card"
            >
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-lilac-50 text-[1.35rem] text-lilac-700">
                <ReplayIcon fontSize="inherit" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{t('home.bookAgain')}</span>
                <span className="block truncate text-sm text-ink-600">
                  {t('home.bookAgainText', { services: serviceNames(lastVisit, pick) })}
                </span>
              </span>
              <ArrowForwardIcon fontSize="inherit" className="shrink-0 text-xl text-ink-500" />
            </Link>
          ) : null}

          <InstallBanner />

          <nav aria-label={t('home.shortcuts')} className="grid grid-cols-2 gap-3">
            <Shortcut to={lp('/services')} label={t('home.shortcutServices')} icon={SpaIcon} color="cyan" />
            <Shortcut to={lp('/bookings')} label={t('home.shortcutBookings')} icon={CalendarIcon} color="peach" />
            <Shortcut to={lp('/studio')} label={t('home.shortcutStudio')} icon={StorefrontIcon} color="mint" />
            <Shortcut onClick={() => setContactOpen(true)} label={t('home.shortcutContact')} icon={ChatIcon} color="lilac" />
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-8 lg:mt-0">
          {popular.length > 0 ? (
            <section aria-labelledby="popular-title">
              <SectionHeading
                id="popular-title"
                title={t('home.popular')}
                action={
                  <Link to={lp('/services')} className="text-sm font-semibold text-ink-700 underline-offset-4 hover:underline">
                    {t('common:actions.seeAll')}
                  </Link>
                }
              />
              <ul className="no-scrollbar -mx-[var(--gutter)] flex snap-x snap-mandatory scroll-px-[var(--gutter)] gap-3 overflow-x-auto px-[var(--gutter)] pb-2 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                {popular.map((service) => {
                  const color = catalog.categoryById.get(service.categoryId)?.color ?? 'blush';
                  return (
                    <li key={service.id} className="w-[11.5rem] shrink-0 snap-start lg:w-auto">
                      <Link
                        to={`${lp('/book')}?services=${service.id}`}
                        className="press flex h-full flex-col rounded-xl bg-white p-3 ring-1 ring-inset ring-ink-100 transition-shadow hover:shadow-card"
                      >
                        <span className={cx('flex h-28 items-center justify-center rounded-lg', SWATCH[color].field)}>
                          <NailArt art={service.art} color={color} className="w-32" />
                        </span>
                        <span className="mt-3 line-clamp-2 text-sm font-bold leading-snug">{pick(service.name)}</span>
                        <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-sm">
                          <span className="text-ink-600">{formatDuration(t, service.durationMin)}</span>
                          <span className="tabular font-bold text-rose-700">{formatPrice(t, service.price, currency, service.priceFrom)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <Link
            to={lp('/studio')}
            className="press flex items-center gap-4 rounded-xl bg-ink-50 p-4 transition-colors hover:bg-ink-100"
          >
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-white text-[1.35rem] text-mint-700">
              <LocationIcon fontSize="inherit" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">
                {hours ? t('home.openToday', { time: hours.close }) : t('home.closedToday')}
              </span>
              <span className="block truncate text-sm text-ink-600">{address || t('common:brand.city')}</span>
            </span>
            <ArrowForwardIcon fontSize="inherit" className="shrink-0 text-xl text-ink-500" />
          </Link>
        </div>
      </div>

      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
