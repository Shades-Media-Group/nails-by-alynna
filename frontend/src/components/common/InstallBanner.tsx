import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CloseIcon, InstallIcon } from '@/components/ui/icons';
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
    <div className="relative flex items-center gap-3 rounded-xl bg-cyan-50 p-4 pr-12">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-white text-[1.35rem] text-cyan-700">
        <InstallIcon fontSize="inherit" />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-cyan-800">{t('installBanner.title')}</p>
        <p className="text-sm text-cyan-800/90">{t('installBanner.text')}</p>
        <Link to={lp('/app')} className="mt-1 inline-block text-sm font-bold text-ink-900 underline">
          {t('installBanner.action')}
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('actions.close')}
        className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-pill text-[1.2rem] text-cyan-800 hover:bg-white/60"
      >
        <CloseIcon fontSize="inherit" />
      </button>
    </div>
  );
}
