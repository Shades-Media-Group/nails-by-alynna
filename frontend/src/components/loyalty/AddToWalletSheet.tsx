import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { QrCode } from '@/components/common/QrCode';
import { Logo } from '@/components/brand/Logo';
import { Button, Sheet, Skeleton } from '@/components/ui';
import { ScheduleIcon, WalletIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { groupMemberCode } from '@/lib/member-code';
import { ordinal } from '@/lib/ordinal';
import { isStandalone, walletsHere, type WalletKind } from '@/lib/platform';
import { walletQueries } from '@/services/api/wallet';
import type { LoyaltyCard } from '@/types/api';

interface AddToWalletSheetProps {
  open: boolean;
  onClose: () => void;
  /** A Wallet was opened with the card (the Home block then goes away). */
  onAdded: () => void;
  card: LoyaltyCard;
  name: string;
  studio: string;
}

/**
 * The loyalty card for Apple Wallet or Google Wallet: a preview drawn like the pass the server
 * signs (blush field, stamps up top, the name, the next discount, the member QR code), then this
 * device's Wallet button. A Wallet the studio hasn't set up yet says so instead of a button.
 */
export function AddToWalletSheet({
  open,
  onClose,
  onAdded,
  card,
  name,
  studio,
}: AddToWalletSheetProps) {
  const { t } = useTranslation(['loyalty', 'common']);
  const wallets = walletsHere();
  const status = useQuery({ ...walletQueries.status(), enabled: open });
  const ready = (wallet: WalletKind) =>
    open && wallets.includes(wallet) && status.data?.[wallet] === true;
  const links = {
    apple: useQuery({ ...walletQueries.link('apple'), enabled: ready('apple') }),
    google: useQuery({ ...walletQueries.link('google'), enabled: ready('google') }),
  };
  const offered = wallets.filter((wallet) => status.data?.[wallet]);
  const waiting = wallets.filter((wallet) => status.data && !status.data[wallet]);

  const add = (wallet: WalletKind) => {
    const link = links[wallet];
    const url = link.data?.url;
    if (!url || link.isFetching) {
      if (link.isError) void link.refetch();
      return;
    }
    onAdded();
    if (wallet === 'google') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    // Safari shows its "Add to Apple Wallet" sheet over the page; the installed app opens the file
    // in a separate view, so the app itself never gets stuck on it.
    if (isStandalone()) window.open(url, '_blank', 'noopener');
    else window.location.assign(url);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('wallet.title')} description={t('wallet.text')}>
      <PassPreview card={card} name={name} studio={studio} />

      <div className="mt-5 flex flex-col gap-2.5">
        {status.isPending ? (
          <Skeleton rounded="pill" className="h-13" />
        ) : status.isError ? (
          <Alert>{errorMessage(t, status.error)}</Alert>
        ) : (
          <>
            {offered.map((wallet) => (
              <div key={wallet} className="flex flex-col gap-2">
                <Button
                  fullWidth
                  icon={WalletIcon}
                  loading={links[wallet].isFetching}
                  onClick={() => add(wallet)}
                >
                  {t(wallet === 'apple' ? 'wallet.addApple' : 'wallet.addGoogle')}
                </Button>
                {links[wallet].isError && !links[wallet].isFetching ? (
                  <Alert>{errorMessage(t, links[wallet].error)}</Alert>
                ) : null}
              </div>
            ))}
            {waiting.length > 0 ? (
              <p className="flex items-start gap-2.5 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
                <ScheduleIcon fontSize="inherit" className="mt-0.5 shrink-0 text-lg text-ink-500" />
                <span>
                  <span className="block font-semibold text-ink-900">
                    {offered.length === 0
                      ? t('wallet.soon')
                      : t(waiting[0] === 'apple' ? 'wallet.soonApple' : 'wallet.soonGoogle')}
                  </span>
                  {offered.length === 0 ? t('wallet.soonText') : null}
                </span>
              </p>
            ) : null}
            {offered.length > 0 ? (
              <p className="text-center text-xs text-ink-600">{t('wallet.snapshot')}</p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The card as Wallet will show it, laid out the way Wallet lays out a store card (see
 * backend/src/modules/wallet/apple.ts): logo and studio name on the left of the header with the
 * stamps on the right, the member's name as the large primary field, the next discount under it,
 * and the QR code on a white plate at the foot. Same blush field, ink text and rose labels as
 * the signed pass, the card's proportions and corner, and the soft lift of a pass in the Wallet.
 */
function PassPreview({ card, name, studio }: { card: LoyaltyCard; name: string; studio: string }) {
  const { t } = useTranslation('loyalty');
  const { locale } = useLocale();
  const { loyalty } = card;
  const next = loyalty.enabled ? loyalty.nextReward : null;
  const label = 'text-[0.8125rem] leading-none text-ink-600';

  return (
    <figure
      aria-label={t('wallet.preview')}
      className="mx-auto flex aspect-[1/1.3] w-full max-w-[20rem] flex-col rounded-[0.875rem] bg-blush-100 px-4 pb-4 pt-3.5 text-ink-900 shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_18px_40px_-18px_rgb(143_20_70/0.45),0_2px_6px_-2px_rgb(37_39_38/0.18)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Logo variant="mark" className="w-9 shrink-0" />
          <span className="truncate text-[0.9375rem] font-semibold">{studio}</span>
        </div>
        {loyalty.enabled ? (
          <dl className="shrink-0 text-right">
            <dt className={label}>{t('wallet.stamps')}</dt>
            <dd className="tabular mt-1 text-[1.0625rem] font-medium leading-none">
              {loyalty.stamps}/{loyalty.cycle}
            </dd>
          </dl>
        ) : null}
      </div>

      <dl className="mt-6">
        <dt className={label}>{t('qr.member')}</dt>
        <dd className="mt-1.5 text-[1.75rem] font-normal leading-tight tracking-[-0.01em] [overflow-wrap:anywhere]">
          {name}
        </dd>
      </dl>
      {next ? (
        <dl className="mt-4">
          <dt className={label}>{t('wallet.next')}</dt>
          <dd className="mt-1 text-[1.0625rem] font-medium leading-snug">
            {next.inVisits === 1
              ? t('wallet.nextVisit', { percent: next.percent })
              : t('nextOn', { percent: next.percent, ordinal: ordinal(next.visit, locale) })}
          </dd>
        </dl>
      ) : null}

      <div className="mt-auto flex justify-center pt-4">
        <div className="rounded-[0.625rem] bg-white px-3 pb-1.5 pt-3 text-center">
          <QrCode value={card.card.url} label={t('qr.label')} className="size-28 rounded-none" />
          <p className="tabular mt-1 text-xs font-medium text-ink-700">
            {groupMemberCode(card.card.code)}
          </p>
        </div>
      </div>
    </figure>
  );
}
