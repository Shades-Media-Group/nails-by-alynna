import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { InfoIcon } from '@/components/ui/icons';

/** Always-visible reminder while signed in to a shared demo account. */
export function DemoRibbon() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  if (!user?.isDemo) return null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-peach-100 pt-[var(--safe-top)] text-peach-800">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-semibold">
        <span className="rounded-pill bg-white/70 px-2 py-0.5 uppercase tracking-wider">{t('demo.badge')}</span>
        <InfoIcon fontSize="inherit" className="hidden text-sm sm:block" />
        <span>{t('demo.text')}</span>
      </p>
    </div>
  );
}
