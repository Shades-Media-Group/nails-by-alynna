import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { Button, Select, Skeleton, Switch, TextField, toast } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { formatDuration } from '@/lib/format';
import { isEmail } from '@/lib/validation';
import type { I18nText } from '@/types/api';
import { adminApi, adminQueries, type StudioSettings } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { I18nFields } from '../components/I18nFields';
import { fillFromRo } from '../components/utils';

type TextKey = 'name' | 'legalName' | 'legalId' | 'address' | 'city' | 'mapsUrl' | 'phone' | 'whatsapp' | 'viber' | 'telegram' | 'instagram' | 'email';
type I18nKey = 'tagline' | 'about' | 'policy';
type NumberKey = 'slotStepMin' | 'leadTimeMin' | 'horizonDays' | 'cancellationWindowHours' | 'bufferMin' | 'maxActiveBookings';
type ChoiceKey = 'timezone' | 'currency';

type Field =
  | { kind: 'text'; key: TextKey; maxLength: number; type?: 'text' | 'email' | 'url' | 'tel'; required?: boolean; placeholder?: string; prefix?: string }
  | { kind: 'i18n'; key: I18nKey; maxLength: number; multiline?: boolean; required?: boolean }
  | { kind: 'switch'; key: 'requireApproval' }
  | { kind: 'number'; key: NumberKey; options: number[] }
  | { kind: 'choice'; key: ChoiceKey; options: string[] };

interface SectionDef {
  id: string;
  fields: Field[];
}

const SECTIONS: SectionDef[] = [
  {
    id: 'studio',
    fields: [
      { kind: 'text', key: 'name', maxLength: 60, required: true },
      { kind: 'text', key: 'legalName', maxLength: 120 },
      { kind: 'text', key: 'legalId', maxLength: 13, placeholder: '1000600000000' },
      { kind: 'text', key: 'address', maxLength: 160 },
      { kind: 'text', key: 'city', maxLength: 60 },
      { kind: 'text', key: 'mapsUrl', maxLength: 500, type: 'url', placeholder: 'https://maps.app.goo.gl/…' },
    ],
  },
  {
    id: 'contacts',
    fields: [
      { kind: 'text', key: 'phone', maxLength: 32, type: 'tel', placeholder: '+373 69 123 456' },
      { kind: 'text', key: 'whatsapp', maxLength: 32, type: 'tel', placeholder: '+373 69 123 456' },
      { kind: 'text', key: 'viber', maxLength: 32, type: 'tel', placeholder: '+373 69 123 456' },
      { kind: 'text', key: 'telegram', maxLength: 80, prefix: '@' },
      { kind: 'text', key: 'instagram', maxLength: 80, prefix: '@' },
      { kind: 'text', key: 'email', maxLength: 254, type: 'email' },
    ],
  },
  {
    id: 'booking',
    fields: [
      { kind: 'switch', key: 'requireApproval' },
      { kind: 'number', key: 'leadTimeMin', options: [0, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880] },
      { kind: 'number', key: 'horizonDays', options: [7, 14, 21, 30, 45, 60, 90, 120, 180, 365] },
      { kind: 'number', key: 'cancellationWindowHours', options: [0, 1, 2, 3, 6, 12, 24, 48, 72] },
      { kind: 'number', key: 'slotStepMin', options: [5, 10, 15, 20, 30, 60] },
      { kind: 'number', key: 'bufferMin', options: [0, 5, 10, 15, 20, 30, 45, 60] },
      { kind: 'number', key: 'maxActiveBookings', options: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20] },
    ],
  },
  {
    id: 'texts',
    fields: [
      { kind: 'i18n', key: 'tagline', maxLength: 80, required: true },
      { kind: 'i18n', key: 'about', maxLength: 600, multiline: true },
      { kind: 'i18n', key: 'policy', maxLength: 600, multiline: true },
    ],
  },
  {
    id: 'region',
    fields: [
      { kind: 'choice', key: 'timezone', options: ['Europe/Chisinau', 'Europe/Bucharest', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'UTC'] },
      { kind: 'choice', key: 'currency', options: ['MDL', 'EUR', 'USD', 'RON'] },
    ],
  },
];

/** Problem with a value as a validation code, mirroring the API (which stays the authority). */
function issueOf(field: Field, value: unknown): string | null {
  if (field.kind === 'text') {
    const text = String(value ?? '').trim();
    if (field.required && !text) return 'required';
    if (field.key === 'legalId' && !/^(\d{13})?$/.test(text)) return 'invalid_idno';
    if (field.key === 'mapsUrl' && text && !/^https:\/\/\S+$/i.test(text)) return 'invalid_url';
    if (field.key === 'email' && text && !isEmail(text)) return 'invalid_email';
  }
  if (field.kind === 'i18n' && field.required && !(value as I18nText).ro.trim()) return 'required';
  return null;
}

/** The value as it will be saved: trimmed, handles without "@", empty languages filled from Romanian. */
function prepared(field: Field, value: unknown): unknown {
  if (field.kind === 'text') {
    const text = String(value ?? '').trim();
    return field.prefix === '@' ? text.replace(/^@/, '') : text;
  }
  if (field.kind === 'i18n') {
    const text = value as I18nText;
    return field.required || text.ro.trim() ? fillFromRo(text) : { ro: '', ru: text.ru.trim(), en: text.en.trim() };
  }
  return value;
}

/** Studio details, contacts, booking rules and texts: everyone reads them, the owner edits them. */
export default function SettingsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { user } = useAuth();
  const isOwner = user?.role === 'administrator';
  const settings = useQuery(adminQueries.settings());

  return (
    <div className="pb-8">
      <AdminHeader title={t('settings.title')} subtitle={isOwner ? t('settings.subtitleOwner') : t('settings.subtitle')} />
      <div className="gutter-x mt-6 flex flex-col gap-10 lg:px-0">
        {!isOwner ? <Alert tone="info">{t('settings.readOnly')}</Alert> : null}
        {settings.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} rounded="xl" className="h-64" />)
        ) : settings.isError ? (
          <Alert>{errorMessage(t, settings.error)}</Alert>
        ) : (
          SECTIONS.map((section) => <Section key={section.id} section={section} settings={settings.data} canEdit={isOwner} />)
        )}
      </div>
    </div>
  );
}

function Section({ section, settings, canEdit }: { section: SectionDef; settings: StudioSettings; canEdit: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const initial = () => Object.fromEntries(section.fields.map((f) => [f.key, settings[f.key]])) as Partial<StudioSettings>;
  const [form, setForm] = useState<Partial<StudioSettings>>(initial);
  const [touched, setTouched] = useState(false);
  const set = (key: keyof StudioSettings, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const changed = Object.fromEntries(
    section.fields
      .map((f) => [f.key, prepared(f, form[f.key])] as const)
      .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(settings[key])),
  ) as Partial<StudioSettings>;
  const dirty = Object.keys(changed).length > 0;
  const issues = Object.fromEntries(
    section.fields.map((f) => [f.key, issueOf(f, form[f.key])] as const).filter((entry): entry is readonly [keyof StudioSettings, string] => entry[1] !== null),
  );

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings(changed),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminQueries.settings().queryKey, updated);
      // Clients read the studio config; free times depend on the booking rules.
      for (const queryKey of [['config'], ['admin', 'stats'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      setTouched(false);
      toast.success(t('common.saved'));
    },
  });
  const server = fieldErrors(t, save.error);
  const message = (key: string): string | undefined => {
    const code = touched ? issues[key] : undefined;
    if (code) return t(`settings.issues.${code}`, { defaultValue: t(`common:validation.${code}`, { defaultValue: t('common:validation.invalid') }) });
    return server[key] ?? server[`${key}.ro`];
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(issues).length > 0 || !dirty) return;
    save.mutate();
  };

  const label = (key: string) => t(`settings.fields.${key}`);
  const hint = (key: string) => t(`settings.hints.${key}`, { defaultValue: '' }) || undefined;
  const formatNumber = (key: NumberKey, value: number) => {
    if (key === 'horizonDays') return t('settings.days', { count: value });
    if (key === 'cancellationWindowHours') return value === 0 ? t('settings.anyTime') : t('settings.hoursBefore', { count: value });
    if (key === 'maxActiveBookings') return String(value);
    if (value === 0) return t('settings.none');
    return formatDuration(t, value);
  };

  const display = (field: Field): string => {
    const value = settings[field.key];
    if (field.kind === 'i18n') {
      const text = value as I18nText;
      return text[locale] || text.ro || t('settings.notSet');
    }
    if (field.kind === 'switch') return value ? t('common.yes') : t('common.no');
    if (field.kind === 'number') return formatNumber(field.key, value as number);
    const text = String(value ?? '');
    return text ? `${field.kind === 'text' && field.prefix ? field.prefix : ''}${text}` : t('settings.notSet');
  };

  return (
    <section aria-labelledby={`settings-${section.id}`} className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id={`settings-${section.id}`} className="text-h2 font-extrabold">
          {t(`settings.sections.${section.id}.title`)}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t(`settings.sections.${section.id}.text`)}</p>
      </div>

      {!canEdit ? (
        <dl className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white px-4 ring-1 ring-inset ring-ink-100">
          {section.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
              <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{label(field.key)}</dt>
              <dd className="min-w-0 whitespace-pre-line break-words text-[0.9375rem] font-semibold">{display(field)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
          {section.fields.map((field) => {
            if (field.kind === 'text') {
              return (
                <TextField
                  key={field.key}
                  label={field.required ? label(field.key) : `${label(field.key)} (${t('common.optional')})`}
                  type={field.type ?? 'text'}
                  inputMode={field.key === 'legalId' ? 'numeric' : undefined}
                  autoComplete="off"
                  spellCheck={field.type === 'email' || field.type === 'url' ? false : undefined}
                  maxLength={field.maxLength}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={String(form[field.key] ?? '')}
                  onChange={(e) => set(field.key, e.target.value)}
                  error={message(field.key)}
                  hint={hint(field.key)}
                />
              );
            }
            if (field.kind === 'i18n') {
              return (
                <div key={field.key} className="flex flex-col gap-1">
                  <I18nFields
                    label={label(field.key)}
                    value={form[field.key] as I18nText}
                    onChange={(value) => set(field.key, value)}
                    maxLength={field.maxLength}
                    multiline={field.multiline}
                    required={field.required}
                    error={message(field.key)}
                  />
                  {hint(field.key) ? <p className="pl-1 text-sm text-ink-600">{hint(field.key)}</p> : null}
                </div>
              );
            }
            if (field.kind === 'switch') {
              return (
                <Switch
                  key={field.key}
                  checked={Boolean(form[field.key])}
                  onChange={(value) => set(field.key, value)}
                  label={label(field.key)}
                  description={hint(field.key)}
                />
              );
            }
            if (field.kind === 'number') {
              const value = Number(form[field.key]);
              const options = [...new Set([...field.options, value])].sort((a, b) => a - b);
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Select
                    label={label(field.key)}
                    value={String(value)}
                    onChange={(e) => set(field.key, Number(e.target.value))}
                    options={options.map((n) => ({ value: String(n), label: formatNumber(field.key, n) }))}
                    error={message(field.key)}
                  />
                  {hint(field.key) ? <p className="pl-1 text-sm text-ink-600">{hint(field.key)}</p> : null}
                </div>
              );
            }
            const value = String(form[field.key] ?? '');
            const options = [...new Set([value, ...field.options])].filter(Boolean);
            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Select
                  label={label(field.key)}
                  value={value}
                  onChange={(e) => set(field.key, e.target.value)}
                  options={options.map((o) => ({ value: o, label: o.replace(/_/g, ' ') }))}
                  error={message(field.key)}
                />
                {hint(field.key) ? <p className="pl-1 text-sm text-ink-600">{hint(field.key)}</p> : null}
              </div>
            );
          })}

          {section.id === 'region' && dirty ? <Alert tone="warning">{t('settings.regionWarning')}</Alert> : null}
          {save.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, save.error)}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <Button type="submit" size="md" disabled={!dirty} loading={save.isPending} className="min-w-32">
              {t('common.save')}
            </Button>
            {dirty ? (
              <Button
                size="md"
                variant="ghost"
                onClick={() => {
                  setForm(initial());
                  setTouched(false);
                  save.reset();
                }}
              >
                {t('appointment.discard')}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
