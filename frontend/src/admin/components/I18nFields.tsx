import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField, Textarea } from '@/components/ui';
import { LOCALES, type Locale } from '@/i18n/config';
import type { I18nText } from '@/types/api';

/** The same text in Romanian, Russian and English, one field per language. */
export function I18nFields({
  label,
  hint,
  value,
  onChange,
  multiline,
  rows = 2,
  required,
  maxLength,
  error,
  errors,
  disabled,
}: {
  label: string;
  /** Under the label, for all three fields. */
  hint?: ReactNode;
  value: I18nText;
  onChange: (value: I18nText) => void;
  multiline?: boolean;
  /** Visible lines of a multiline field. */
  rows?: number;
  required?: boolean;
  maxLength: number;
  /** Shown on the Romanian field. */
  error?: string;
  /** Per language, e.g. the API's `details.ru`. */
  errors?: Partial<Record<Locale, string>>;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin');
  const hintId = useId();
  const errorFor = (locale: Locale) => (locale === 'ro' ? error : undefined) ?? errors?.[locale];
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-describedby={hint ? hintId : undefined}>
      <legend className="mb-1 text-sm font-semibold text-ink-700">{label}</legend>
      {hint ? (
        <p id={hintId} className="-mt-1 mb-1 text-sm text-ink-600">
          {hint}
        </p>
      ) : null}
      {LOCALES.map((locale: Locale) =>
        multiline ? (
          <Textarea
            key={locale}
            label={t(`languages.${locale}`)}
            lang={locale}
            rows={rows}
            maxLength={maxLength}
            value={value[locale]}
            onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            error={errorFor(locale)}
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
            error={errorFor(locale)}
          />
        ),
      )}
    </fieldset>
  );
}
