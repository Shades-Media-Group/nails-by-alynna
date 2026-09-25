import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { QrCode } from '@/components/common/QrCode';
import { PageHeader } from '@/components/layout/PageHeader';
import { StampCard } from '@/components/loyalty/StampCard';
import { useNextRewardText } from '@/components/loyalty/useNextRewardText';
import { Button, Skeleton } from '@/components/ui';
import { CheckIcon, LoyaltyIcon, RedeemIcon, ReplayIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, formatPrice } from '@/lib/format';
import { ordinal } from '@/lib/ordinal';
import { loyaltyQueries } from '@/services/api/loyalty';

const order = (i: number) => ({ '--i': i }) as CSSProperties;

/** The client's loyalty card: the QR code staff scan at the desk, the stamps, the rules. */
export default function LoyaltyPage() {
  const { t } = useTranslation(['loyalty', 'common']);
  const { locale, lp } = useLocale();
  const { currency, timeZone } = useStudio();
  const card = useQuery(loyaltyQueries.mine());
  const nextText = useNextRewardText();

  if (card.isPending) {
    return (
      <div className="pb-6">
        <PageHeader title={t('title')} back />
        <div className="gutter-x mt-5 flex flex-col gap-4 lg:px-0">
          <Skeleton rounded="xl" className="h-96" />
          <Skeleton rounded="xl" className="h-48" />
        </div>
      </div>
    );
  }
  if (card.isError) {
    return (
      <div className="pb-6">
        <PageHeader title={t('title')} back />
        <div className="gutter-x mt-5 flex flex-col items-start gap-3 lg:px-0">
          <Alert>{errorMessage(t, card.error)}</Alert>
          <Button variant="outline" size="sm" icon={ReplayIcon} onClick={() => void card.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const { card: member, loyalty } = card.data;
  const next = nextText(loyalty);
  const money = (amount: number) => formatPrice(t, amount, currency);
  const code = `${member.code.slice(0, 4)} ${member.code.slice(4)}`;

  return (
    <div className="pb-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} back backTo={lp('/home')} />

      <div className="gutter-x mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:px-0">
        <section aria-labelledby="qr-title" className="stagger rounded-2xl bg-ink-900 p-5 text-white shadow-raised" style={order(0)}>
          <div className="flex items-center justify-between">
            <span className="caps text-white/70">Nails by Alynna</span>
            <LoyaltyIcon fontSize="inherit" className="text-xl text-rose-200" />
          </div>
          <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3">
            <QrCode value={member.url} label={t('qr.label')} className="size-52 rounded-none sm:size-56" />
          </div>
          <h2 id="qr-title" className="mt-4 text-center text-h3 font-extrabold">
            {t('qr.title')}
          </h2>
          <p className="mx-auto mt-1 max-w-72 text-center text-sm text-white/70">{t('qr.text')}</p>
          <p className="mt-4 text-center">
            <span className="sr-only">{t('qr.code')}: </span>
            <span className="tabular rounded-pill bg-white/10 px-4 py-1.5 font-mono text-base font-semibold tracking-[0.18em]">{code}</span>
          </p>
        </section>

        <div className="flex flex-col gap-5">
          <section aria-labelledby="stamps-title" className="stagger rounded-2xl bg-blush-100 p-5" style={order(1)}>
            {loyalty.enabled ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="stamps-title" className="text-h3 font-extrabold">
                    {t('stamps', { stamps: loyalty.stamps, cycle: loyalty.cycle })}
                  </h2>
                  <span className="shrink-0 text-sm font-semibold text-ink-600">{t('cardNumber', { card: loyalty.card })}</span>
                </div>
                {next ? <p className="mt-1 text-[0.9375rem] font-semibold text-rose-700 first-letter:uppercase">{next}</p> : null}
                <StampCard status={loyalty} className="mt-5" />
              </>
            ) : (
              <p id="stamps-title" className="text-ink-700">
                {t('off')}
              </p>
            )}
          </section>

          <section aria-labelledby="how-title" className="stagger rounded-2xl bg-white p-5 ring-1 ring-inset ring-ink-100" style={order(2)}>
            <h2 id="how-title" className="text-h3 font-extrabold">
              {t('how.title')}
            </h2>
            <ul className="mt-3 flex flex-col gap-2.5 text-[0.9375rem] text-ink-700">
              <HowLine>{t('how.stamp')}</HowLine>
              {loyalty.rewards.map((reward) => (
                <HowLine key={reward.visit} strong>
                  {t('how.reward', { ordinal: ordinal(reward.visit, locale), percent: reward.percent })}
                </HowLine>
              ))}
              <HowLine>{t('how.restart', { cycle: loyalty.cycle })}</HowLine>
              <HowLine>{t('how.applied')}</HowLine>
            </ul>
          </section>

          <section aria-labelledby="history-title" className="stagger" style={order(3)}>
            <h2 id="history-title" className="text-h3 font-extrabold">
              {t('history.title')}
            </h2>
            {loyalty.history.length === 0 ? (
              <p className="mt-2 text-sm text-ink-600">{t('history.empty')}</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-ink-100 rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
                {loyalty.history.map((used) => (
                  <li key={used.appointmentId}>
                    <Link
                      to={lp(`/bookings/${used.appointmentId}`)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50"
                    >
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-rose-50 text-lg text-rose-600">
                        <RedeemIcon fontSize="inherit" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold first-letter:uppercase">
                          {t('history.line', {
                            ordinal: ordinal(used.visit, locale),
                            percent: used.percent,
                            amount: money(used.discount),
                          })}
                        </span>
                        <span className="block text-sm text-ink-600">{formatDayShort(used.date, locale, timeZone)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HowLine({ children, strong }: { children: string; strong?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-mint-50 text-sm text-mint-700">
        <CheckIcon fontSize="inherit" />
      </span>
      <span className={strong ? 'font-semibold text-ink-900 first-letter:uppercase' : 'first-letter:uppercase'}>{children}</span>
    </li>
  );
}
