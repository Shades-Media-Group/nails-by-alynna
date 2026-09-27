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
export function AddToWalletSheet({ open, onClose, onAdded, card, name, studio }: AddToWalletSheetProps) {
  const { t } = useTranslation(['loyalty', 'common']);
  const wallets = walletsHere();
  const status = useQuery({ ...walletQueries.status(), enabled: open });
  const ready = (wallet: WalletKind) => open && wallets.includes(wallet) && status.data?.[wallet] === true;
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
                {links[wallet].isError && !links[wallet].isFetching ? <Alert>{errorMessage(t, links[wallet].error)}</Alert> : null}
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
            {offered.length > 0 ? <p className="text-center text-xs text-ink-600">{t('wallet.snapshot')}</p> : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** The card as Wallet will show it (see backend/src/modules/wallet/apple.ts). */
function PassPreview({ card, name, studio }: { card: LoyaltyCard; name: string; studio: string }) {
  const { t } = useTranslation('loyalty');
  const { locale } = useLocale();
  const { loyalty } = card;
  const next = loyalty.enabled ? loyalty.nextReward : null;
  const label = 'caps text-rose-700';

  return (
    <figure aria-label={t('wallet.preview')} className="rounded-2xl bg-blush-100 p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo variant="mark" className="w-11 shrink-0" />
          <span className="truncate text-[0.9375rem] font-bold">{studio}</span>
        </div>
        {loyalty.enabled ? (
          <dl className="shrink-0 text-right">
            <dt className={label}>{t('wallet.stamps')}</dt>
            <dd className="tabular text-h2 font-extrabold">
              {loyalty.stamps}/{loyalty.cycle}
            </dd>
          </dl>
        ) : null}
      </div>
      <dl className="mt-4 flex flex-col gap-3">
        <div>
          <dt className={label}>{t('qr.member')}</dt>
          <dd className="text-h2 font-extrabold [overflow-wrap:anywhere]">{name}</dd>
        </div>
        {next ? (
          <div>
            <dt className={label}>{t('wallet.next')}</dt>
            <dd className="font-semibold">
              {next.inVisits === 1
                ? t('wallet.nextVisit', { percent: next.percent })
                : t('nextOn', { percent: next.percent, ordinal: ordinal(next.visit, locale) })}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mx-auto mt-4 w-fit rounded-xl bg-white px-3 pb-2 pt-3 text-center">
        <QrCode value={card.card.url} label={t('qr.label')} className="size-28 rounded-none" />
        <p className="tabular mt-1 text-xs font-semibold text-ink-700">{groupMemberCode(card.card.code)}</p>
      </div>
    </figure>
  );
}
