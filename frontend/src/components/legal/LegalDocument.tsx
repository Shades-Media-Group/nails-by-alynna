import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { IconButton } from '@/components/ui';
import { ArrowBackIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { LegalContent, type LegalDoc } from './LegalContent';

/** Terms and Privacy as full pages: comfortable line length and a short contents list. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const { t } = useTranslation('legal');
  const { lp } = useLocale();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-white">
      <header className="gutter-x sticky top-0 z-20 border-b border-ink-100 bg-white pt-[var(--safe-top)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3">
          <IconButton
            icon={ArrowBackIcon}
            label={t('common:actions.back')}
            size="sm"
            variant="soft"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(lp('/'), { replace: true }))}
          />
          <Logo variant="mark" className="w-10" />
        </div>
      </header>

      <article className="gutter-x mx-auto max-w-3xl pb-[calc(var(--safe-bottom)+3rem)] pt-6 animate-page">
        <LegalContent doc={doc} />
      </article>
    </div>
  );
}
