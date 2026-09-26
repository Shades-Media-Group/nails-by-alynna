import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { LOCALE_LABELS, LOCALE_SHORT, LOCALES, type Locale } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { meApi } from '@/services/api/endpoints';

interface LanguageSwitcherProps {
  compact?: boolean;
  /**
   * Menus used on phones and tablets (the staff app): every option is a 44 px tap target while
   * the pill keeps its height, and the options share whatever width the switcher is given.
   */
  touch?: boolean;
  className?: string;
  tone?: 'light' | 'blush';
}

/** RO · RU · EN — always one tap away, before and after sign-in. */
export function LanguageSwitcher({
  compact,
  touch,
  className,
  tone = 'light',
}: LanguageSwitcherProps) {
  const { t } = useTranslation('common');
  const { locale, switchLocale } = useLocale();
  const { user, setUser } = useAuth();

  const choose = (target: Locale) => {
    if (target === locale) return;
    switchLocale(target);
    // Signed-in: keep the account language in sync (emails, notifications and sign-in use it).
    if (user && user.locale !== target) {
      meApi.update({ locale: target }).then(setUser, () => undefined);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('language.choose')}
      className={cx(
        'inline-flex rounded-pill p-1',
        tone === 'blush' ? 'bg-white/70' : 'bg-ink-50',
        className,
      )}
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
            // The tap area reaches 6 px past the chip above and below (44 px for the compact size).
            touch &&
              'relative min-w-11 flex-1 before:absolute before:inset-x-0 before:-inset-y-1.5',
            l === locale
              ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgb(37_39_38/0.14)]'
              : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {LOCALE_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
