import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';

/**
 * /c/:code — where the loyalty QR points. Scanned with a phone camera by staff, it opens the
 * client's card in the dashboard; the client lands on their own card; anyone else sees what
 * the code is and a way into the app.
 */
export default function CardLinkPage() {
  const { t } = useTranslation('loyalty');
  const { lp } = useLocale();
  const { user, isStaff } = useAuth();
  const { code = '' } = useParams();

  if (isStaff) return <Navigate to={`${lp('/admin/scan')}?code=${encodeURIComponent(code)}`} replace />;
  if (user) return <Navigate to={lp('/loyalty')} replace />;

  return (
    <main className="gutter-x mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center py-10 text-center">
      <Logo className="w-40" />
      <h1 className="mt-8 text-h1 font-extrabold">{t('link.title')}</h1>
      <p className="mt-2 text-ink-600">{t('link.text')}</p>
      <ButtonLink to={lp('/login')} className="mt-8">
        {t('link.open')}
      </ButtonLink>
    </main>
  );
}
