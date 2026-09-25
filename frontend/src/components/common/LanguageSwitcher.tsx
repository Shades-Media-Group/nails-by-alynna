import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { LOCALE_LABELS, LOCALE_SHORT, LOCALES, type Locale } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { meApi } from '@/services/api/endpoints';

/** RO · RU · EN — always one tap away, before and after sign-in. */
export function LanguageSwitcher({ compact, className, tone = 'light' }: { compact?: boolean; className?: string; tone?: 'light' | 'blush' }) {
  const { t } = useTranslation('common');
  const { locale, switchLocale } = useLocale();
  const { user, setUser } = useAuth();

  const choose = (target: Locale) => {
    if (target === locale) return;
    switchLocale(target);
    // Signed-in: keep the account language in sync (emails use it).
    if (user && user.locale !== target) {
      meApi.update({ locale: target }).then(setUser, () => undefined);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('language.choose')}
      className={cx('inline-flex rounded-pill p-1', tone === 'blush' ? 'bg-white/70' : 'bg-ink-50', className)}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          aria-label={LOCALE_LABELS[l]}
          onClick={() => choose(l)}
          className={cx(
            'press rounded-pill font-semibold tracking-wide transition-colors',
            compact ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-[0.8125rem]',
            l === locale ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgb(37_39_38/0.14)]' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {LOCALE_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
