import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRightIcon, CloseIcon, InstallIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { hasConsent } from '@/lib/consent';
import { currentPlatform } from '@/lib/platform';
import { session, storage, STORAGE_KEYS } from '@/lib/storage';

function dismissedBefore(): boolean {
  return Boolean(storage.get(STORAGE_KEYS.installDismissed) || session.get(STORAGE_KEYS.installDismissed));
}

/** Gentle nudge on phones that aren't running the installed app yet. */
export function InstallBanner() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const platform = currentPlatform();
  const [dismissed, setDismissed] = useState(dismissedBefore);

  if (!platform.mobile || platform.standalone || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    // Remember across visits only with "Preferences" consent; otherwise for this session.
    if (hasConsent('preferences')) storage.set(STORAGE_KEYS.installDismissed, '1');
    else session.set(STORAGE_KEYS.installDismissed, '1');
  };

  return (
    <div className="relative flex items-center gap-3 rounded-2xl bg-cyan-50 py-3 pl-3 pr-12">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-cyan-700">
        <InstallIcon fontSize="inherit" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-bold leading-snug text-cyan-800">{t('installBanner.title')}</p>
        <Link
          to={lp('/app')}
          className="group mt-0.5 inline-flex items-center gap-0.5 text-sm font-semibold text-ink-900 underline-offset-4 hover:underline"
        >
          {t('installBanner.action')}
          <ChevronRightIcon
            fontSize="inherit"
            className="text-base transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
          />
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('actions.close')}
        className="press absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-pill text-[1.2rem] text-cyan-800 hover:bg-white/70"
      >
        <CloseIcon fontSize="inherit" />
      </button>
    </div>
  );
}
