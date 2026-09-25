import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { NailArt } from '@/components/brand/NailArt';
import { ContactSheet } from '@/components/common/ContactSheet';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, Button, ButtonAnchor, ButtonLink, ListGroup, ListRow, Skeleton } from '@/components/ui';
import { ChatIcon, DirectionsIcon, EventIcon, LocationIcon, PrivacyIcon, ShieldIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { LOCALE_TAGS } from '@/i18n/config';
import { contactLinks } from '@/lib/contact';
import { cx } from '@/lib/cx';
import { studioHours, weekdayIn, WEEKDAYS } from '@/lib/hours';
import { queries } from '@/services/queries';

const order = (i: number) => ({ '--i': i }) as CSSProperties;

/** "HH:MM" now in the studio's time zone, to compare with opening hours. */
function clockIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

/** /studio — where the salon is, when it's open, who works there and how to reach it. */
export default function StudioPage() {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { data: config, timeZone } = useStudio();
  const staff = useQuery(queries.staff());
  const [contactOpen, setContactOpen] = useState(false);
  // Read the clock once per visit to the page (not during every render).
  const [now] = useState(() => ({ weekday: weekdayIn(timeZone), time: clockIn(timeZone) }));

  const studio = config?.studio;
  const name = studio?.name || t('common:brand.name');
  const address = [studio?.address, studio?.city].filter(Boolean).join(', ');
  const masters = staff.data ?? [];
  const today = staff.data ? studioHours(masters, now.weekday) : null;
  const status = !staff.data
    ? null
    : today && now.time >= today.open && now.time < today.close
      ? { open: true, text: t('studio.openNow', { time: today.close }) }
      : today && now.time < today.open
        ? { open: false, text: t('studio.opensToday', { time: today.open }) }
        : { open: false, text: t('studio.closedNow') };
  const weekdayName = (iso: number) =>
    new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, iso)));
  const links = studio ? contactLinks(studio, (key) => t(`common:${key}`)) : [];
  const about = studio?.about ? pick(studio.about) : '';

  return (
    <div className="pb-6">
      <PageHeader title={name} subtitle={studio?.tagline ? pick(studio.tagline) : undefined} back backTo={lp('/home')} />

      <div className="gutter-x mt-5 grid gap-5 lg:grid-cols-2 lg:items-start lg:px-0">
        <div className="flex flex-col gap-5">
          <section
            aria-label={t('studio.address')}
            className="stagger relative overflow-hidden rounded-2xl bg-blush-100 p-5"
            style={order(0)}
          >
            <NailArt art="french" color="blush" className="pointer-events-none absolute -right-8 -top-6 w-36 rotate-12 opacity-60" />
            {status ? (
              <p
                className={cx(
                  'relative inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-semibold',
                  status.open ? 'bg-mint-50 text-mint-700' : 'bg-white text-ink-700',
                )}
              >
                <span aria-hidden="true" className={cx('size-2 rounded-pill', status.open ? 'bg-mint-500' : 'bg-ink-400')} />
                {status.text}
              </p>
            ) : (
              <Skeleton className="h-7 w-44 rounded-pill" />
            )}
            <p className="relative mt-4 flex items-start gap-2 text-[1.0625rem] font-bold">
              <LocationIcon fontSize="inherit" className="mt-0.5 shrink-0 text-xl text-rose-600" />
              {address || t('common:brand.city')}
            </p>
            <div className="relative mt-4 flex flex-wrap gap-2">
              <ButtonLink to={lp('/book')} size="sm" icon={EventIcon}>
                {t('studio.book')}
              </ButtonLink>
              {studio?.mapsUrl ? (
                <ButtonAnchor size="sm" variant="outline" className="bg-white" icon={DirectionsIcon} href={studio.mapsUrl} target="_blank" rel="noopener noreferrer">
                  {t('common:contact.directions')}
                </ButtonAnchor>
              ) : null}
              <Button size="sm" variant="outline" className="bg-white" icon={ChatIcon} onClick={() => setContactOpen(true)}>
                {t('studio.contact')}
              </Button>
            </div>
          </section>

          <section aria-labelledby="hours-title" className="stagger rounded-2xl bg-white p-5 ring-1 ring-inset ring-ink-100" style={order(1)}>
            <h2 id="hours-title" className="text-h3 font-extrabold">
              {t('studio.hours')}
            </h2>
            {staff.isPending ? (
              <Skeleton className="mt-3 h-48" />
            ) : (
              <dl className="mt-3 flex flex-col">
                {WEEKDAYS.map((day) => {
                  const hours = studioHours(masters, day);
                  const isToday = day === now.weekday;
                  return (
                    <div
                      key={day}
                      className={cx(
                        'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-[0.9375rem]',
                        isToday && 'bg-ink-50 font-semibold',
                      )}
                    >
                      <dt className="capitalize">
                        {weekdayName(day)}
                        {isToday ? <span className="ml-2 text-sm font-semibold text-rose-700">{t('studio.today')}</span> : null}
                      </dt>
                      <dd className={cx('tabular', hours ? 'text-ink-900' : 'text-ink-500')}>
                        {hours ? `${hours.open}–${hours.close}` : t('studio.closed')}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {about ? (
            <section aria-labelledby="about-title" className="stagger" style={order(2)}>
              <h2 id="about-title" className="text-h3 font-extrabold">
                {t('studio.about')}
              </h2>
              <p className="mt-2 max-w-[62ch] whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-700">{about}</p>
            </section>
          ) : null}

          {masters.length > 0 ? (
            <section aria-labelledby="team-title" className="stagger" style={order(3)}>
              <h2 id="team-title" className="text-h3 font-extrabold">
                {t('studio.team')}
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {masters.map((master) => (
                  <li key={master.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-inset ring-ink-100">
                    <Avatar name={master.name} color={master.color} />
                    <span className="min-w-0">
                      <span className="block font-bold">{master.name}</span>
                      <span className="block text-sm text-ink-600">{pick(master.title)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="policy-title" className="stagger rounded-2xl bg-ink-50 p-5 text-[0.9375rem] text-ink-700" style={order(4)}>
            <h2 id="policy-title" className="text-h3 font-extrabold text-ink-900">
              {t('studio.policy')}
            </h2>
            <p className="mt-2">{t('studio.freeCancel', { count: config?.booking.cancellationWindowHours ?? 12 })}</p>
            {config?.booking.requireApproval ? <p className="mt-1">{t('studio.approval')}</p> : null}
            {config?.booking.policy && pick(config.booking.policy) ? <p className="mt-1 text-ink-600">{pick(config.booking.policy)}</p> : null}
          </section>

          {links.length > 0 ? (
            <div className="stagger" style={order(5)}>
              <ListGroup title={t('studio.contact')}>
                {links.map((link) => (
                  <ListRow key={link.key} icon={link.icon} label={link.label} href={link.href} external={link.external} />
                ))}
              </ListGroup>
            </div>
          ) : null}

          <ListGroup title={t('studio.legal')}>
            <ListRow icon={PrivacyIcon} label={t('common:footer.privacy')} to={lp('/privacy')} />
            <ListRow icon={ShieldIcon} label={t('common:footer.terms')} to={lp('/terms')} />
          </ListGroup>
        </div>
      </div>

      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
