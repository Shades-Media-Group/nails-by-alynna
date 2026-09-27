import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, Chip, SegmentedControl, Select, Sheet, Skeleton, Switch, TextField, Textarea, toast } from '@/components/ui';
import { CheckIcon, EditIcon, ReplayIcon } from '@/components/ui/icons';
import { LOCALES, LOCALE_TAGS, isLocale, type Locale } from '@/i18n/config';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { isApiError } from '@/services/api/client';
import type { I18nText } from '@/types/api';
import {
  REBOOK_TONES,
  adminApi,
  adminQueries,
  type RebookPatch,
  type RebookPreview,
  type RebookSettings as Rebook,
  type RebookText,
  type RebookTone,
} from '../api';
import { sameValue } from './utils';

const empty = (): I18nText => ({ ro: '', ru: '', en: '' });
const emptyText = (): RebookText => ({ title: empty(), body: empty() });

/** The API's defaults (backend/src/modules/settings.ts), for a studio that never saved these. */
const DEFAULTS: Rebook = {
  enabled: true,
  firstAfterDays: 28,
  repeatEveryDays: 14,
  maxReminders: 3,
  channels: { email: true, push: true },
  texts: { first: emptyText(), nudge: emptyText(), last: emptyText() },
};
const FIRST_AFTER = [14, 21, 28, 30, 35, 42, 45, 60, 75, 90];
const REPEAT_EVERY = [7, 10, 14, 21, 28, 30, 45, 60];
const MAX_REMINDERS = [1, 2, 3, 4, 5];
const TITLE_MAX = 80;
const BODY_MAX = 300;
/** What the texts may mention; the API refuses anything else in braces. */
const PLACEHOLDERS = ['name', 'services', 'master'];
const PLACEHOLDER = /\{([^{}]*)\}/g;
const MARKUP = /<\/?[a-z!][^<>]*>/i;

function read(settings: Record<string, unknown>): Rebook {
  const saved = (settings.rebook ?? {}) as Partial<Rebook>;
  const text = (value: Partial<RebookText> | undefined): RebookText => ({
    title: { ...empty(), ...value?.title },
    body: { ...empty(), ...value?.body },
  });
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled,
    firstAfterDays: typeof saved.firstAfterDays === 'number' ? saved.firstAfterDays : DEFAULTS.firstAfterDays,
    repeatEveryDays: typeof saved.repeatEveryDays === 'number' ? saved.repeatEveryDays : DEFAULTS.repeatEveryDays,
    maxReminders: typeof saved.maxReminders === 'number' ? saved.maxReminders : DEFAULTS.maxReminders,
    channels: { ...DEFAULTS.channels, ...saved.channels },
    texts: { first: text(saved.texts?.first), nudge: text(saved.texts?.nudge), last: text(saved.texts?.last) },
  };
}

/** What the form changed, as the API takes it: only those parts (texts per message). */
function rebookChanges(saved: Rebook, form: Rebook): RebookPatch {
  const patch: RebookPatch = {};
  if (form.enabled !== saved.enabled) patch.enabled = form.enabled;
  if (form.firstAfterDays !== saved.firstAfterDays) patch.firstAfterDays = form.firstAfterDays;
  if (form.repeatEveryDays !== saved.repeatEveryDays) patch.repeatEveryDays = form.repeatEveryDays;
  if (form.maxReminders !== saved.maxReminders) patch.maxReminders = form.maxReminders;
  if (!sameValue(form.channels, saved.channels)) patch.channels = form.channels;
  const texts = REBOOK_TONES.filter((tone) => !sameValue(form.texts[tone], saved.texts[tone]));
  if (texts.length > 0) patch.texts = Object.fromEntries(texts.map((tone) => [tone, form.texts[tone]]));
  return patch;
}

/** One line, trimmed: how the API stores a text. */
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

/** A text with its placeholders filled, as the API fills it for each client. */
function fillText(template: string, values: Record<string, string | null>): string {
  return template
    .replace(PLACEHOLDER, (match, key: string) => (PLACEHOLDERS.includes(key) ? (values[key] ?? '') : match))
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/,(?=[!?.;:])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textIssue(value: string): 'unknown_placeholder' | 'plain_text' | null {
  if (MARKUP.test(value)) return 'plain_text';
  return [...value.matchAll(PLACEHOLDER)].every(([, key]) => PLACEHOLDERS.includes(key ?? '')) ? null : 'unknown_placeholder';
}

/** The first reminder, the last one, or one in between (as the API picks the wording). */
const toneOf = (step: number, max: number): RebookTone => (step <= 1 ? 'first' : step >= max ? 'last' : 'nudge');

/** Days after the visit each reminder goes out, with the wording it takes. */
function schedule(form: Pick<Rebook, 'firstAfterDays' | 'repeatEveryDays' | 'maxReminders'>) {
  return Array.from({ length: form.maxReminders }, (_, i) => ({
    day: form.firstAfterDays + i * form.repeatEveryDays,
    tone: toneOf(i + 1, form.maxReminders),
  }));
}

const isCustom = (text: RebookText) => LOCALES.some((l) => text.title[l].trim() || text.body[l].trim());
const withValue = (options: number[], value: number) => [...new Set([...options, value])].sort((a, b) => a - b);

/** "28, 42 and 56" in the reader's language. */
const listOf = (days: number[], locale: Locale) =>
  new Intl.ListFormat(LOCALE_TAGS[locale], { style: 'long', type: 'conjunction' }).format(days.map(String));

/** The title and text a client reads, in `locale`: the studio's own or the built-in one. */
function messageIn(text: RebookText, tone: RebookTone, preview: RebookPreview, locale: Locale) {
  const sample = preview.sample[locale] ?? { name: '', services: '', master: '', loyalty: null };
  const pick = (field: keyof RebookText) => tidy(text[field][locale]) || preview.defaults[tone][field][locale];
  const body = fillText(pick('body'), sample);
  return {
    title: fillText(pick('title'), sample),
    // The reminders in between carry the loyalty card's next discount (while the card runs).
    body: tone === 'nudge' && sample.loyalty ? `${body} ${sample.loyalty}` : body,
  };
}

/**
 * Settings → Come-back reminders (owner): whether clients who have not booked since their last
 * visit hear from the studio, when and how, and what the messages say (built-in texts or the
 * studio's own), with a test sent to the owner. Everyone else sees them read-only.
 */
export function RebookSettings({ settings, canEdit, email }: { settings: Record<string, unknown>; canEdit: boolean; email?: string }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale: Locale = isLocale(i18n.language) ? i18n.language : 'ro';
  const queryClient = useQueryClient();
  const current = read(settings);
  const [form, setForm] = useState<Rebook>(current);
  const [editing, setEditing] = useState<RebookTone | null>(null);
  const preview = useQuery(adminQueries.rebook());
  const channelsId = useId();

  const changes = rebookChanges(current, form);
  const dirty = Object.keys(changes).length > 0;
  const noChannel = form.enabled && !form.channels.email && !form.channels.push;

  const save = useMutation({
    mutationFn: () => adminApi.updateRebook(changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminQueries.settings().queryKey, updated);
      // Clients see "Reminders to come back" in their settings only while the studio sends them.
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      toast.success(t('common.saved'));
    },
  });
  const test = useMutation({
    mutationFn: adminApi.rebookTest,
    onSuccess: (result) => {
      const devices = result.push?.sent ?? 0;
      if (result.email && !result.email.sent) toast.error(t('rebook.testEmailFailed'));
      else if (result.email && devices > 0) toast.success(t('rebook.testSentBoth', { email: result.email.to, count: devices }));
      else if (result.email) toast.success(t('rebook.testSentEmail', { email: result.email.to }));
      else if (devices > 0) toast.success(t('rebook.testSentPush', { count: devices }));
      else toast.error(t('rebook.testNone'));
    },
    onError: (error) => toast.error(errorMessage(t, error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dirty && !noChannel) save.mutate();
  };
  const toggleChannel = (channel: 'email' | 'push') =>
    setForm((f) => ({ ...f, channels: { ...f.channels, [channel]: !f.channels[channel] } }));

  const steps = schedule(form);
  const lastDay = steps.at(-1)!.day;
  const days = (count: number) => t('rebook.days', { count });
  // A chosen channel the server cannot send (no email provider, no Web Push keys) is said once.
  const available = preview.data?.available;
  const chosen = (['email', 'push'] as const).filter((channel) => form.channels[channel]);
  const blocked = available && form.enabled ? chosen.filter((channel) => !available[channel]) : [];
  const setupNote =
    blocked.length === 0 ? null : blocked.length === chosen.length ? t('rebook.noneAvailable') : t(`rebook.${blocked[0]}Unavailable`);
  const serverIssue = isApiError(save.error, 'VALIDATION_ERROR') ? Object.values(save.error.fields)[0] : undefined;

  const resetText = (tone: RebookTone) => setForm((f) => ({ ...f, texts: { ...f.texts, [tone]: emptyText() } }));
  const messages = <Messages form={form} preview={preview} locale={locale} canEdit={canEdit} onEdit={setEditing} onReset={resetText} />;

  return (
    <section aria-labelledby="settings-rebook" className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id="settings-rebook" className="text-h2 font-extrabold">
          {t('rebook.title')}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t('rebook.text')}</p>
      </div>

      {!canEdit ? (
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white px-4 ring-1 ring-inset ring-ink-100">
            <Row label={t('rebook.title')} value={current.enabled ? t('rebook.on') : t('rebook.off')} />
            {current.enabled ? (
              <>
                <Row label={t('rebook.firstAfter')} value={days(current.firstAfterDays)} />
                {current.maxReminders > 1 ? <Row label={t('rebook.repeatEvery')} value={days(current.repeatEveryDays)} /> : null}
                <Row label={t('rebook.maxReminders')} value={t('rebook.reminders', { count: current.maxReminders })} />
                <Row
                  label={t('rebook.channels')}
                  value={[current.channels.email ? t('rebook.email') : null, current.channels.push ? t('rebook.push') : null].filter(Boolean).join(', ')}
                />
              </>
            ) : null}
          </dl>
          {current.enabled ? <div className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">{messages}</div> : null}
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
          <Switch
            checked={form.enabled}
            onChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
            label={t('rebook.enabled')}
            description={form.enabled ? t('rebook.enabledText') : t('rebook.offText')}
          />
          <fieldset disabled={!form.enabled} className="flex min-w-0 flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select
                label={t('rebook.firstAfter')}
                value={String(form.firstAfterDays)}
                onChange={(e) => setForm((f) => ({ ...f, firstAfterDays: Number(e.target.value) }))}
                options={withValue(FIRST_AFTER, form.firstAfterDays).map((n) => ({ value: String(n), label: days(n) }))}
              />
              <Select
                label={t('rebook.repeatEvery')}
                value={String(form.repeatEveryDays)}
                disabled={form.maxReminders === 1}
                onChange={(e) => setForm((f) => ({ ...f, repeatEveryDays: Number(e.target.value) }))}
                options={withValue(REPEAT_EVERY, form.repeatEveryDays).map((n) => ({ value: String(n), label: days(n) }))}
              />
              <Select
                label={t('rebook.maxReminders')}
                value={String(form.maxReminders)}
                onChange={(e) => setForm((f) => ({ ...f, maxReminders: Number(e.target.value) }))}
                options={withValue(MAX_REMINDERS, form.maxReminders).map((n) => ({ value: String(n), label: t('rebook.reminders', { count: n }) }))}
              />
            </div>
            <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
              {t('rebook.timeline', { count: lastDay, days: listOf(steps.map((s) => s.day), locale) })}
            </p>
            <div className="flex flex-col gap-2">
              <p id={channelsId} className="text-sm font-medium text-ink-700">
                {t('rebook.channels')}
              </p>
              <div role="group" aria-labelledby={channelsId} className="flex flex-wrap gap-2">
                {(['email', 'push'] as const).map((channel) => (
                  <Chip
                    key={channel}
                    selected={form.channels[channel]}
                    icon={form.channels[channel] ? CheckIcon : undefined}
                    onClick={() => toggleChannel(channel)}
                    className="h-11! px-4.5! disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t(`rebook.${channel}`)}
                  </Chip>
                ))}
              </div>
              {noChannel ? (
                <p className="pl-1 text-sm text-red-600" role="alert">
                  {t('rebook.issues.one_channel')}
                </p>
              ) : null}
              {setupNote ? <p className="pl-1 text-sm text-ink-600">{setupNote}</p> : null}
            </div>
          </fieldset>

          <div className={cx('border-t border-ink-100 pt-5', !form.enabled && 'opacity-60')}>{messages}</div>

          <div className="flex flex-col items-start gap-2 border-t border-ink-100 pt-5">
            <Button variant="outline" size="md" loading={test.isPending} disabled={dirty} onClick={() => test.mutate()}>
              {t('rebook.test')}
            </Button>
            <p className="pl-1 text-sm text-ink-600">{dirty ? t('rebook.testSaveFirst') : t('rebook.testHint', { email: email ?? '' })}</p>
          </div>

          {save.isError ? (
            <Alert>
              {serverIssue
                ? t(`rebook.issues.${serverIssue}`, { defaultValue: t('common:validation.invalid') })
                : errorMessage(t, save.error)}
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <Button type="submit" size="md" disabled={!dirty || noChannel} loading={save.isPending} className="min-w-32">
              {t('common.save')}
            </Button>
            {dirty ? (
              <Button
                size="md"
                variant="ghost"
                onClick={() => {
                  setForm(current);
                  save.reset();
                }}
              >
                {t('appointment.discard')}
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {editing && preview.data ? (
        <TextEditor
          tone={editing}
          value={form.texts[editing]}
          preview={preview.data}
          locale={locale}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setForm((f) => ({ ...f, texts: { ...f.texts, [editing]: text } }));
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
      <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-[0.9375rem] font-semibold">{value}</dd>
    </div>
  );
}

/** The three messages as they arrive on a phone, each with when it goes out. */
function Messages({
  form,
  preview,
  locale,
  canEdit,
  onEdit,
  onReset,
}: {
  form: Rebook;
  preview: UseQueryResult<RebookPreview>;
  locale: Locale;
  canEdit: boolean;
  onEdit: (tone: RebookTone) => void;
  onReset: (tone: RebookTone) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const steps = schedule(form);
  const data = preview.data;
  const when = (tone: RebookTone) => {
    const days = steps.filter((s) => s.tone === tone).map((s) => s.day);
    return days.length > 0 ? t('rebook.when', { count: days.length, days: listOf(days, locale) }) : t('rebook.unused', { count: form.maxReminders });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[0.9375rem] font-semibold text-ink-900">{t('rebook.messages')}</p>
        <p className="mt-0.5 text-sm text-ink-600">{t('rebook.messagesText')}</p>
      </div>
      {preview.isPending ? (
        <div className="flex flex-col gap-3">
          {REBOOK_TONES.map((tone) => (
            <Skeleton key={tone} rounded="xl" className="h-28" />
          ))}
        </div>
      ) : preview.isError || !data?.defaults ? (
        <Alert>{errorMessage(t, preview.error)}</Alert>
      ) : (
        <ul className="flex flex-col gap-5">
          {REBOOK_TONES.map((tone) => {
            const text = form.texts[tone];
            const used = steps.some((s) => s.tone === tone);
            const message = messageIn(text, tone, data, locale);
            const label = t(`rebook.tone.${tone}`);
            return (
              <li key={tone} className="flex max-w-md flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{label}</p>
                    <p className="text-sm text-ink-600">{when(tone)}</p>
                  </div>
                  {isCustom(text) ? <Badge tone="lilac">{t('rebook.custom')}</Badge> : null}
                </div>
                <NotificationPreview title={message.title} body={message.body} muted={!used} />
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" icon={EditIcon} aria-label={`${t('rebook.edit')}: ${label}`} onClick={() => onEdit(tone)}>
                      {t('rebook.edit')}
                    </Button>
                    {isCustom(text) ? (
                      <Button size="sm" variant="ghost" icon={ReplayIcon} onClick={() => onReset(tone)}>
                        {t('rebook.reset')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A notification as a phone shows it: the app icon, the title, the text. */
function NotificationPreview({ title, body, muted }: { title: string; body: string; muted?: boolean }) {
  const { t } = useTranslation('admin');
  return (
    <figure aria-label={t('rebook.preview')} className={cx('rounded-xl bg-ink-50 p-2.5 transition-opacity duration-200', muted && 'opacity-55')}>
      <div className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-card">
        <img src="/icons/pwa-64x64.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-[0.6rem] bg-blush-100" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-semibold text-ink-900">{title}</p>
            <span className="shrink-0 text-xs text-ink-500">{t('rebook.now')}</span>
          </div>
          <p className="mt-0.5 break-words text-sm text-ink-700">{body}</p>
        </div>
      </div>
    </figure>
  );
}

/** Edits one message in the three languages; empty fields keep the built-in text. */
function TextEditor({
  tone,
  value,
  preview,
  locale,
  onClose,
  onDone,
}: {
  tone: RebookTone;
  value: RebookText;
  preview: RebookPreview;
  locale: Locale;
  onClose: () => void;
  onDone: (text: RebookText) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const defaults = preview.defaults[tone];
  const [lang, setLang] = useState<Locale>(locale);
  // Starts from what clients read now, so a word can be changed without retyping the rest.
  const [draft, setDraft] = useState<RebookText>(() => ({
    title: Object.fromEntries(LOCALES.map((l) => [l, value.title[l] || defaults.title[l]])) as I18nText,
    body: Object.fromEntries(LOCALES.map((l) => [l, value.body[l] || defaults.body[l]])) as I18nText,
  }));
  const issue = (field: keyof RebookText, l: Locale) => textIssue(draft[field][l]);
  const message = (field: keyof RebookText) => {
    const code = issue(field, lang);
    return code ? t(`rebook.issues.${code}`) : undefined;
  };
  const set = (field: keyof RebookText, text: string) => setDraft((d) => ({ ...d, [field]: { ...d[field], [lang]: text } }));
  const shown = messageIn(draft, tone, preview, lang);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const broken = LOCALES.find((l) => issue('title', l) || issue('body', l));
    if (broken) {
      setLang(broken);
      return;
    }
    // Saved as the API keeps it; a text left as the built-in one is stored empty, so it follows
    // later improvements of the built-in wording.
    const keep = (field: keyof RebookText) =>
      Object.fromEntries(
        LOCALES.map((l) => {
          const text = tidy(draft[field][l]);
          return [l, text === tidy(defaults[field][l]) ? '' : text];
        }),
      ) as I18nText;
    onDone({ title: keep('title'), body: keep('body') });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={t(`rebook.tone.${tone}`)}
      description={t('rebook.editor.description')}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" form="rebook-text" size="md" className="min-w-32">
            {t('rebook.editor.done')}
          </Button>
          <Button size="md" variant="soft" icon={ReplayIcon} onClick={() => setDraft({ title: { ...defaults.title }, body: { ...defaults.body } })}>
            {t('rebook.editor.reset')}
          </Button>
        </div>
      }
    >
      <form id="rebook-text" onSubmit={submit} noValidate className="flex flex-col gap-5 py-2">
        <SegmentedControl
          label={t('rebook.editor.language')}
          value={lang}
          onChange={setLang}
          options={LOCALES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
          className="w-full"
        />
        <NotificationPreview title={shown.title} body={shown.body} />
        <TextField
          label={t('rebook.editor.titleField')}
          lang={lang}
          maxLength={TITLE_MAX}
          value={draft.title[lang]}
          placeholder={defaults.title[lang]}
          onChange={(e) => set('title', e.target.value)}
          error={message('title')}
        />
        <Textarea
          label={t('rebook.editor.bodyField')}
          lang={lang}
          rows={4}
          maxLength={BODY_MAX}
          value={draft.body[lang]}
          placeholder={defaults.body[lang]}
          onChange={(e) => set('body', e.target.value)}
          error={message('body')}
        />
      </form>
    </Sheet>
  );
}
