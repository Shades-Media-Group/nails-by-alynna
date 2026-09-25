import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { StampCard } from '@/components/loyalty/StampCard';
import { useNextRewardText } from '@/components/loyalty/LoyaltyBits';
import { Avatar, Badge, Button, ButtonLink, Sheet, Textarea, toast } from '@/components/ui';
import { AddIcon, CallIcon, ChevronRightIcon, PersonIcon, RemoveIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, formatPhone, formatPrice, formatTime } from '@/lib/format';
import { groupMemberCode } from '@/lib/member-code';
import { adminLoyaltyApi, type ClientLoyaltyCard } from './api';

/**
 * A client's card at the desk: who it is, the stamps, the visits to come with the discount each
 * will get, and a stamp added or removed by hand for visits outside the app.
 */
export function CardPanel({ data }: { data: ClientLoyaltyCard }) {
  const { t } = useTranslation(['loyalty', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, currency } = useStudio();
  const queryClient = useQueryClient();
  const nextText = useNextRewardText();
  const [adjust, setAdjust] = useState<1 | -1 | null>(null);
  const [reason, setReason] = useState('');
  const { client, loyalty, appointments } = data;
  const money = (amount: number) => formatPrice(t, amount, currency);
  const next = nextText(loyalty);

  const stamp = useMutation({
    mutationFn: (delta: 1 | -1) => adminLoyaltyApi.stamp(client.id, delta, reason.trim()),
    onSuccess: (fresh, delta) => {
      queryClient.setQueryData(['admin', 'loyalty', 'card', client.memberCode], fresh);
      queryClient.setQueryData(['admin', 'loyalty', 'client', client.id], fresh);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'appointments'] });
      toast.success(delta > 0 ? t('card.added') : t('card.removed'));
      setAdjust(null);
      setReason('');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
        <Avatar name={client.name} surname={client.surname} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-h3 font-extrabold">
            {client.name} {client.surname}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
            {client.phone ? (
              <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1 font-semibold text-ink-800 hover:underline">
                <CallIcon fontSize="inherit" />
                {formatPhone(client.phone)}
              </a>
            ) : null}
            <span className="tabular font-mono tracking-[0.12em]">{groupMemberCode(client.memberCode)}</span>
            {!client.hasAccount ? <Badge tone="peach">{t('card.noAccount')}</Badge> : null}
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-blush-100 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-h3 font-extrabold">{t('stamps', { stamps: loyalty.stamps, cycle: loyalty.cycle })}</h2>
          <span className="shrink-0 text-sm font-semibold text-ink-600">
            {t('cardNumber', { card: loyalty.card })} · {t('card.visits', { count: loyalty.visits })}
          </span>
        </div>
        {next ? <p className="mt-1 font-semibold text-rose-700 first-letter:uppercase">{next}</p> : null}
        {!loyalty.enabled ? <p className="mt-1 text-sm text-ink-600">{t('off')}</p> : null}
        <StampCard status={loyalty} className="mt-4" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={AddIcon} onClick={() => setAdjust(1)}>
            {t('card.addStamp')}
          </Button>
          {loyalty.visits > 0 ? (
            <Button size="sm" variant="outline" icon={RemoveIcon} className="bg-white" onClick={() => setAdjust(-1)}>
              {t('card.removeStamp')}
            </Button>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-h3 font-extrabold">{t('card.upcoming')}</h2>
        {appointments.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">{t('card.noUpcoming')}</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-col divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
              {appointments.map((a) => (
                <li key={a.id}>
                  <Link to={lp(`/admin/appointments/${a.id}`)} className="group flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold first-letter:uppercase">
                        {formatDayShort(a.start, locale, timeZone)}, {formatTime(a.start, locale, timeZone)}
                      </span>
                      <span className="block text-sm text-ink-600">{a.services.map((s) => pick(s.name)).join(' · ')}</span>
                      {a.loyalty ? (
                        <span className={a.loyalty.percent > 0 ? 'mt-1 block text-sm font-semibold text-rose-700' : 'mt-1 block text-sm text-ink-600'}>
                          {a.loyalty.percent > 0
                            ? t('card.thisVisit', { percent: a.loyalty.percent, amount: money(a.loyalty.discount) })
                            : t('card.stampOnly', { visit: a.loyalty.visit, cycle: a.loyalty.cycle })}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRightIcon fontSize="inherit" className="shrink-0 text-xl text-ink-400 transition-transform group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-ink-500">{t('card.completeHint')}</p>
          </>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <ButtonLink to={lp(`/admin/clients/${client.id}`)} size="sm" variant="outline" icon={PersonIcon}>
          {t('card.profile')}
        </ButtonLink>
        <ButtonLink to={`${lp('/admin/appointments/new')}?clientId=${client.id}`} size="sm" variant="soft" icon={AddIcon}>
          {t('card.book')}
        </ButtonLink>
      </div>

      <Sheet
        open={adjust !== null}
        onClose={() => setAdjust(null)}
        title={adjust === -1 ? t('card.stampTitleRemove') : t('card.stampTitleAdd')}
        description={t('card.stampText')}
        footer={
          <Button fullWidth loading={stamp.isPending} onClick={() => adjust && stamp.mutate(adjust)}>
            {adjust === -1 ? t('card.removeStamp') : t('card.addStamp')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 py-2">
          {stamp.isError ? <Alert>{errorMessage(t, stamp.error)}</Alert> : null}
          <Textarea label={t('card.reason')} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
      </Sheet>
    </div>
  );
}
