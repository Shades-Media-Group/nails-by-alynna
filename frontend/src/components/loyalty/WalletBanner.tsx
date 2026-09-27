import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { ChevronRightIcon, CloseIcon, WalletIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { hasConsent } from '@/lib/consent';
import { cx } from '@/lib/cx';
import { walletsHere } from '@/lib/platform';
import { session, storage, STORAGE_KEYS } from '@/lib/storage';
import { loyaltyQueries } from '@/services/api/loyalty';
import { AddToWalletSheet } from './AddToWalletSheet';

const doneBefore = () => Boolean(storage.get(STORAGE_KEYS.walletBanner) || session.get(STORAGE_KEYS.walletBanner));

/** Remember across visits only with "Preferences" consent; otherwise for this session (as InstallBanner). */
function remember(value: 'closed' | 'added') {
  if (hasConsent('preferences')) storage.set(STORAGE_KEYS.walletBanner, value);
  else session.set(STORAGE_KEYS.walletBanner, value);
}

/**
 * Home, under the studio: "your loyalty card in Wallet", built like the install banner. A tap
 * opens the card's Wallet sheet. Clients only; gone once closed or once the card was added.
 */
export function WalletBanner({ className, style }: { className?: string; style?: CSSProperties }) {
  const { t } = useTranslation(['loyalty', 'common']);
  const { user } = useAuth();
  const { data: config } = useStudio();
  const card = useQuery(loyaltyQueries.mine());
  const [done, setDone] = useState(doneBefore);
  const [open, setOpen] = useState(false);

  if (user?.role !== 'client' || !card.data?.loyalty.enabled) return null;

  const wallets = walletsHere();
  const action = wallets.length > 1 ? t('wallet.add') : t(wallets[0] === 'apple' ? 'wallet.addApple' : 'wallet.addGoogle');

  return (
    <>
      {done ? null : (
        <div style={style} className={cx('relative flex items-center gap-3 rounded-2xl bg-blush-100 py-3 pl-3 pr-12', className)}>
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-rose-600">
            <WalletIcon fontSize="inherit" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-bold leading-snug text-rose-700">{t('wallet.title')}</p>
            {/* The button stretches over the whole block, so a tap anywhere on it opens the sheet. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="group mt-0.5 inline-flex items-center gap-0.5 text-left text-sm font-semibold text-ink-900 underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:transition-colors after:content-[''] hover:underline hover:after:bg-white/30 active:after:bg-white/50"
            >
              {action}
              <ChevronRightIcon
                fontSize="inherit"
                className="text-base transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
              />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setDone(true);
              remember('closed');
            }}
            aria-label={t('common:actions.close')}
            className="press absolute right-2 top-1/2 z-10 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-pill text-[1.2rem] text-rose-700 hover:bg-white/70"
          >
            <CloseIcon fontSize="inherit" />
          </button>
        </div>
      )}
      <AddToWalletSheet
        open={open}
        onClose={() => setOpen(false)}
        onAdded={() => {
          setOpen(false);
          setDone(true);
          remember('added');
        }}
        card={card.data}
        name={`${user.name} ${user.surname}`}
        studio={config?.studio.name ?? t('common:brand.name')}
      />
    </>
  );
}
