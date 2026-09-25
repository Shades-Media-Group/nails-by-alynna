import { useTranslation } from 'react-i18next';
import { homePathFor, useAuth } from '@/app/auth';
import { NailArt } from '@/components/brand/NailArt';
import { ButtonLink } from '@/components/ui';
import { HomeIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';

export default function NotFoundPage() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const { user } = useAuth();
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-white px-6 text-center">
      <div className="max-w-sm">
        <NailArt art="removal" color="peach" className="mx-auto w-44" />
        <h1 className="mt-6 text-h1 font-extrabold">{t('errors.notFoundTitle')}</h1>
        <p className="mt-3 text-ink-600">{t('errors.notFoundText')}</p>
        <ButtonLink to={lp(homePathFor(user))} icon={HomeIcon} className="mt-8">
          {t('errors.goHome')}
        </ButtonLink>
      </div>
    </main>
  );
}
