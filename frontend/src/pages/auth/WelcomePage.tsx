import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Logo } from '@/components/brand/Logo';
import { Alert } from '@/components/common/Alert';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { ButtonLink } from '@/components/ui';
import { ArrowForwardIcon } from '@/components/ui/icons';
import { safeNextPath } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { authApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';

const OAUTH_ERRORS = ['google', 'google_cancelled', 'google_conflict', 'google_disabled', 'account_disabled'];

/** Figma "App Prototype _select_login": pick email or Google. */
export default function WelcomePage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const [params] = useSearchParams();
  const config = useQuery(queries.config());
  const next = safeNextPath(params.get('next'));
  const error = params.get('error');
  const carry = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <AuthLayout
      centered
      footer={
        <>
          {t('welcome.noAccount')}{' '}
          <Link to={`${lp('/signup')}${carry}`} className="font-bold text-rose-700 underline-offset-4 hover:underline">
            {t('welcome.signUp')}
          </Link>
        </>
      }
    >
      <Logo className="mx-auto w-[9.5rem] lg:hidden" />

      <h1 className="mt-10 text-[2.4rem] font-extrabold uppercase leading-[0.95] tracking-[-0.03em] sm:text-display">
        <span className="block text-ink-900">{t('common:brand.tagline1')}</span>
        <span className="block text-rose-500">{t('common:brand.tagline2')}</span>
      </h1>
      <p className="mt-3 max-w-xs text-ink-600">{t('welcome.subtitle')}</p>

      {error && OAUTH_ERRORS.includes(error) ? (
        <Alert className="mt-6">{t(`oauthErrors.${error}`)}</Alert>
      ) : null}

      <div className="mt-8 flex flex-col gap-3">
        <ButtonLink to={`${lp('/login/email')}${carry}`} variant="soft" trailingIcon={ArrowForwardIcon} fullWidth>
          {t('welcome.email')}
        </ButtonLink>

        {config.data?.auth.google ? (
          <>
            <div className="flex items-center gap-3 py-1 text-xs text-ink-500" aria-hidden="true">
              <span className="h-px flex-1 bg-ink-200" />
              {t('welcome.or')}
              <span className="h-px flex-1 bg-ink-200" />
            </div>
            <a
              href={authApi.googleStartUrl(locale, true, next ?? undefined)}
              className="press flex h-14 items-center justify-center gap-3 rounded-pill bg-white px-6 font-semibold text-ink-900 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300"
            >
              <GoogleMark className="size-5" />
              {t('welcome.google')}
            </a>
          </>
        ) : null}
      </div>
    </AuthLayout>
  );
}
