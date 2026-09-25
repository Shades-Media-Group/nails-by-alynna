import { useTranslation } from 'react-i18next';
import { TextField, Textarea } from '@/components/ui';
import { LOCALES, type Locale } from '@/i18n/config';
import type { I18nText } from '@/types/api';

/** The same text in Romanian, Russian and English, one field per language. */
export function I18nFields({
  label,
  value,
  onChange,
  multiline,
  required,
  maxLength,
  error,
  disabled,
}: {
  label: string;
  value: I18nText;
  onChange: (value: I18nText) => void;
  multiline?: boolean;
  required?: boolean;
  maxLength: number;
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin');
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-ink-700">{label}</legend>
      {LOCALES.map((locale: Locale) =>
        multiline ? (
          <Textarea
            key={locale}
            label={t(`languages.${locale}`)}
            lang={locale}
            rows={2}
            maxLength={maxLength}
            value={value[locale]}
            onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            error={locale === 'ro' ? error : undefined}
          />
        ) : (
          <TextField
            key={locale}
            label={t(`languages.${locale}`)}
            lang={locale}
            maxLength={maxLength}
            required={required && locale === 'ro'}
            value={value[locale]}
            onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            error={locale === 'ro' ? error : undefined}
          />
        ),
      )}
    </fieldset>
  );
}
