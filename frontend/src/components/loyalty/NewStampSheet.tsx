import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { Button, ButtonLink, Sheet } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';
import { SHEET_ORDER, useSheetTurn } from '@/lib/sheetQueue';
import { newStamps, readSeenVisits, saveSeenVisits } from '@/lib/stampsSeen';
import { loyaltyQueries } from '@/services/api/loyalty';
import type { LoyaltyStatus } from '@/types/api';
import { StampCard } from './StampCard';
import { useNextRewardText } from './useNextRewardText';

/**
 * A stamp for the visit just finished: the card opens with the new stamp pressing in, and what
 * it brings next ("Next visit: 15% off"). Once per stamp, live at the desk or on the next
 * opening: this device remembers how many visits it last showed.
 */
export function NewStampSheet() {
  const { t } = useTranslation('loyalty');
  const { lp } = useLocale();
  const { user } = useAuth();
  const nextText = useNextRewardText();
  const client = user?.role === 'client' && !user.isDemo;
  // No timer of its own: the card page and Home refresh it; this one looks on each return.
  const card = useQuery({ ...loyaltyQueries.mine(), enabled: client, refetchInterval: false });
  const status = card.data?.loyalty;

  // React's "adjust state while rendering": the count this device saved last is read before
  // the effect below replaces it.
  const [seen, setSeen] = useState<{ status: LoyaltyStatus | undefined; added: number }>({
    status: undefined,
    added: 0,
  });
  if (status !== seen.status) {
    const added =
      client && user && status?.enabled ? newStamps(status.visits, readSeenVisits(user.id)) : 0;
    setSeen({ status, added: seen.added || added });
  }

  useEffect(() => {
    if (client && user && status?.enabled) saveSeenVisits(user.id, status.visits);
  }, [client, user, status]);

  // The card starts without the new stamps, then they press in (StampCard pops what arrives).
  const [pressed, setPressed] = useState(false);
  const open = useSheetTurn(
    'new-stamp',
    SHEET_ORDER.celebration,
    seen.added > 0 && Boolean(status),
  );
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setPressed(true), 420);
    return () => window.clearTimeout(timer);
  }, [open]);
  const close = () => {
    setSeen((current) => ({ ...current, added: 0 }));
    setPressed(false);
  };

  if (!status) return null;
  const before: LoyaltyStatus = { ...status, stamps: Math.max(0, status.stamps - seen.added) };
  const next = nextText(status);

  return (
    <Sheet open={open} onClose={close} title={t('stamped.title', { count: seen.added })} hideTitle>
      <div className="flex flex-col items-center pb-1 text-center">
        <p className="text-h2 font-extrabold" aria-hidden="true">
          {t('stamped.title', { count: seen.added })}
        </p>
        <p className="mt-1.5 text-ink-600">
          {t('stamps', { stamps: status.stamps, cycle: status.cycle })}
        </p>
        <StampCard status={pressed ? status : before} className="mt-5 w-full max-w-sm" />
        {next ? (
          <p className="mt-4 font-bold text-rose-700 first-letter:uppercase">{next}</p>
        ) : null}
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <ButtonLink to={lp('/loyalty')} variant="primary" fullWidth onClick={close}>
            {t('stamped.card')}
          </ButtonLink>
          <Button variant="ghost" size="md" fullWidth onClick={close}>
            {t('stamped.done')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
