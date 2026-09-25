import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { homePathFor, useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { ButtonLink } from '@/components/ui';
import { CheckIcon, InstallIcon, LanguageIcon } from '@/components/ui/icons';
import { splitLocale, localizePath, preferredLocale } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { openConsentSettings } from '@/lib/consent';
import { currentPlatform } from '@/lib/platform';
import { storage, STORAGE_KEYS } from '@/lib/storage';

/**
 * "/" — decides where a visitor starts.
 * - Bare "/" with no saved language: saved → browser language → English.
 * - Laptops/desktops, the installed app and signed-in visitors skip straight in.
 * - Phones and tablets get this page: web or app, one tap each.
 */
export default function LandingPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const platform = currentPlatform();

  if (pathname === '/' && !splitLocale(pathname).explicit) {
    const preferred = preferredLocale(storage.get(STORAGE_KEYS.locale), navigator.languages ?? [navigator.language]);
    if (preferred !== locale) return <Navigate to={localizePath('/', preferred)} replace />;
  }

  const destination = lp(homePathFor(user));
  if (user || !platform.mobile || platform.standalone) return <Navigate to={destination} replace />;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-blush-100">
      <NailArt art="gel" color="blush" className="pointer-events-none absolute -right-16 -top-6 w-64 rotate-[18deg] opacity-70" />
      <NailArt art="french" color="lilac" className="pointer-events-none absolute -bottom-10 -left-16 w-60 -rotate-12 opacity-60" />

      <div className="gutter-x relative flex justify-end pt-[calc(var(--safe-top)+0.75rem)]">
        <LanguageSwitcher compact tone="blush" />
      </div>

      <main id="main" className="gutter-x relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <Logo className="mx-auto w-[min(58vw,14rem)]" />
        {/* Hidden for now at the studio's request; kept to bring back later. */}
        <p className="mx-auto mt-8 hidden max-w-[21rem] text-center text-[1.0625rem] leading-relaxed text-ink-800">
          {t('landing.lead')}
        </p>
        <ul className="mx-auto mt-6 hidden flex-col gap-2 text-sm text-ink-800">
          {[t('landing.why1'), t('landing.why2'), t('landing.why3')].map((line) => (
            <li key={line} className="flex items-center gap-2">
              <CheckIcon fontSize="inherit" className="text-base text-rose-600" />
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col gap-3">
          <ButtonLink to={destination} icon={LanguageIcon} fullWidth>
            {t('landing.web')}
          </ButtonLink>
          <p className="-mt-1 text-center text-xs text-ink-600">{t('landing.webHint')}</p>
          <ButtonLink to={lp('/app')} variant="outline" icon={InstallIcon} fullWidth className="mt-2 bg-white/80">
            {t('landing.app')}
          </ButtonLink>
          <p className="-mt-1 text-center text-xs text-ink-600">{t('landing.appHint')}</p>
        </div>
      </main>

      <footer className="gutter-x relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-[calc(var(--safe-bottom)+1rem)] pt-2 text-xs text-ink-600">
        <Link to={lp('/privacy')} className="whitespace-nowrap underline-offset-4 hover:underline">
          {t('common:footer.privacy')}
        </Link>
        <Link to={lp('/terms')} className="whitespace-nowrap underline-offset-4 hover:underline">
          {t('common:footer.terms')}
        </Link>
        <button type="button" onClick={openConsentSettings} className="underline-offset-4 hover:underline">
          {t('common:footer.cookies')}
        </button>
        <a href="https://shades.md/" target="_blank" rel="noopener" className="w-full text-center text-ink-500 underline-offset-4 hover:underline">
          {t('common:footer.credit')}
        </a>
      </footer>
    </div>
  );
}
