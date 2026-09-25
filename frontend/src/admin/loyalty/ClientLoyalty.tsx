import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StampCard } from '@/components/loyalty/StampCard';
import { useNextRewardText } from '@/components/loyalty/useNextRewardText';
import { ButtonLink, Skeleton } from '@/components/ui';
import { LoyaltyIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { groupMemberCode } from '@/lib/member-code';
import { adminLoyaltyQueries } from './api';

/** Client profile (staff): the loyalty card at a glance, one tap to the full card at the desk. */
export function ClientLoyalty({ clientId }: { clientId: string }) {
  const { t } = useTranslation('loyalty');
  const { lp } = useLocale();
  const card = useQuery(adminLoyaltyQueries.client(clientId));
  const nextText = useNextRewardText();

  if (card.isPending) return <Skeleton rounded="xl" className="h-44" />;
  if (card.isError) return null;
  const { loyalty, client } = card.data;
  const next = nextText(loyalty);

  return (
    <section aria-labelledby="loyalty-title" className="rounded-2xl bg-blush-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="loyalty-title" className="flex items-center gap-2 text-h3 font-extrabold">
            <LoyaltyIcon fontSize="inherit" className="text-xl text-rose-600" />
            {t('admin.client.title')}
          </h2>
          <p className="mt-0.5 text-sm text-ink-700">
            {t('stamps', { stamps: loyalty.stamps, cycle: loyalty.cycle })} · {t('cardNumber', { card: loyalty.card })}
          </p>
          {next ? <p className="mt-0.5 text-sm font-semibold text-rose-700 first-letter:uppercase">{next}</p> : null}
        </div>
        <ButtonLink to={`${lp('/admin/scan')}?code=${client.memberCode}`} size="sm" variant="outline" className="shrink-0 bg-white">
          {t('admin.client.open')}
        </ButtonLink>
      </div>
      <StampCard status={loyalty} className="mt-4" />
      <p className="mt-3 text-xs text-ink-600">
        <span className="tabular font-mono tracking-[0.12em]">{t('admin.client.code', { code: groupMemberCode(client.memberCode) })}</span>
      </p>
    </section>
  );
}
