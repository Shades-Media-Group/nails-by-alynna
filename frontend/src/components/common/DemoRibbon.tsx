import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { InfoIcon } from '@/components/ui/icons';

/**
 * Reminder at the top of every screen while signed in to a shared demo account. It scrolls away
 * with the page, so it never sits on top of a screen's own sticky header.
 */
export function DemoRibbon() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  if (!user?.isDemo) return null;
  return (
    <div role="status" className="relative z-50 bg-peach-100 pt-[var(--safe-top)] text-peach-800">
      {/* Always one row: the copy is short in every language and the type scales down on narrow phones. */}
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 whitespace-nowrap px-3 py-2 text-[clamp(0.6875rem,3.3vw,0.75rem)] font-semibold">
        <span className="shrink-0 rounded-pill bg-white/70 px-2 py-0.5 uppercase tracking-wider">{t('demo.badge')}</span>
        <InfoIcon fontSize="inherit" className="hidden shrink-0 text-sm sm:block" />
        <span className="min-w-0 overflow-hidden text-ellipsis">{t('demo.text')}</span>
      </p>
    </div>
  );
}
