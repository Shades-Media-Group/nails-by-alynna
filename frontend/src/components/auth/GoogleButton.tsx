import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Spinner } from '@/components/ui/Spinner';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { authApi } from '@/services/api/endpoints';

/**
 * Google sign-in and sign-up are one step: the API creates the account on first use. A plain
 * link, not a popup, so it works in installed apps and with strict popup blockers.
 */
export function GoogleButton({ label, next, className }: { label: string; next?: string | null; className?: string }) {
  const { locale } = useLocale();
  const [leaving, setLeaving] = useState(false);

  // Coming back with the browser's back button restores this page from the bfcache.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    <a
      href={authApi.googleStartUrl(locale, true, next ?? undefined)}
      onClick={() => setLeaving(true)}
      aria-busy={leaving || undefined}
      className={cx(
        'press flex h-12 items-center justify-center gap-3 rounded-pill bg-white px-6 text-[0.9375rem] font-semibold text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300',
        className,
      )}
    >
      {leaving ? <Spinner className="size-5 text-ink-500" /> : <GoogleMark className="size-5" />}
      {label}
    </a>
  );
}

/** Consent line for the Google path, which has no terms checkbox of its own. */
export function GoogleTerms({ className }: { className?: string }) {
  const { t } = useTranslation('auth');
  const { lp } = useLocale();
  return (
    <p className={cx('text-center text-xs leading-relaxed text-ink-500', className)}>
      <Trans
        t={t}
        i18nKey="welcome.googleTerms"
        components={{
          terms: <Link to={lp('/terms')} className="font-semibold text-ink-700 underline underline-offset-2" />,
          privacy: <Link to={lp('/privacy')} className="font-semibold text-ink-700 underline underline-offset-2" />,
        }}
      />
    </p>
  );
}

/** "or" rule between the Google button and the email path. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs font-medium text-ink-500" aria-hidden="true">
      <span className="h-px flex-1 bg-ink-200" />
      {label}
      <span className="h-px flex-1 bg-ink-200" />
    </div>
  );
}
