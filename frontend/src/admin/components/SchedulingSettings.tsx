import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Select, Switch, toast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { formatDuration } from '@/lib/format';
import { api } from '@/services/api/client';

interface SchedulingFields {
  smartSlots: boolean;
  maxGapMin: number;
  minBookableGapMin: number;
}

/** The API's defaults (backend/src/modules/settings.ts), for a studio that never saved these. */
const DEFAULTS: SchedulingFields = { smartSlots: true, maxGapMin: 10, minBookableGapMin: 90 };
const MAX_GAPS = [0, 5, 10, 15, 20, 30];
const BOOKABLE_GAPS = [30, 45, 60, 90, 120, 180];

function read(settings: Record<string, unknown>): SchedulingFields {
  return {
    smartSlots: typeof settings.smartSlots === 'boolean' ? settings.smartSlots : DEFAULTS.smartSlots,
    maxGapMin: typeof settings.maxGapMin === 'number' ? settings.maxGapMin : DEFAULTS.maxGapMin,
    minBookableGapMin: typeof settings.minBookableGapMin === 'number' ? settings.minBookableGapMin : DEFAULTS.minBookableGapMin,
  };
}

/** A saved value outside the list stays selectable. */
const withValue = (options: number[], value: number) => [...new Set([...options, value])].sort((a, b) => a - b);

/** Minutes after midnight as "HH:mm", for the worked example. */
const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** The worked example: a visit (with its break) ending at 11:30. */
const EXAMPLE_END = 11 * 60 + 30;

/**
 * Settings → Smart scheduling (owner): which start times clients are offered online, so each
 * master's day stays compact. Everyone else sees the rules read-only.
 */
export function SchedulingSettings({ settings, canEdit }: { settings: Record<string, unknown>; canEdit: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const current = read(settings);
  const [form, setForm] = useState<SchedulingFields>(current);
  const changed = Object.fromEntries(
    (Object.keys(form) as Array<keyof SchedulingFields>).filter((key) => form[key] !== current[key]).map((key) => [key, form[key]]),
  );
  const dirty = Object.keys(changed).length > 0;

  const save = useMutation({
    mutationFn: () => api.patch<{ settings: Record<string, unknown> }>('/admin/settings', changed).then((r) => r.settings),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'settings'], updated);
      // The free times clients and staff see depend on these rules.
      for (const queryKey of [['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(t('common.saved'));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dirty) save.mutate();
  };

  const gap = (minutes: number) => (minutes === 0 ? t('settings.none') : formatDuration(t, minutes));
  const explanation = (fields: SchedulingFields) =>
    fields.maxGapMin > 0
      ? t('scheduling.smartSlotsText', { gap: formatDuration(t, fields.maxGapMin) })
      : t('scheduling.smartSlotsTextStrict');
  const example = t('scheduling.example', {
    end: clock(EXAMPLE_END),
    tight: form.maxGapMin > 0 ? `${clock(EXAMPLE_END)}–${clock(EXAMPLE_END + form.maxGapMin)}` : clock(EXAMPLE_END),
    open: clock(EXAMPLE_END + form.minBookableGapMin),
  });

  return (
    <section aria-labelledby="settings-scheduling" className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id="settings-scheduling" className="text-h2 font-extrabold">
          {t('scheduling.title')}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t('scheduling.text')}</p>
      </div>

      {!canEdit ? (
        <dl className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white px-4 ring-1 ring-inset ring-ink-100">
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
            <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{t('scheduling.smartSlots')}</dt>
            <dd className="min-w-0 text-[0.9375rem] font-semibold">
              {current.smartSlots ? t('scheduling.on') : t('scheduling.off')}
              {current.smartSlots ? <p className="mt-0.5 text-sm font-normal text-ink-600">{explanation(current)}</p> : null}
            </dd>
          </div>
          {current.smartSlots ? (
            <>
              <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
                <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{t('scheduling.maxGap')}</dt>
                <dd className="text-[0.9375rem] font-semibold">{gap(current.maxGapMin)}</dd>
              </div>
              <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
                <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{t('scheduling.minBookableGap')}</dt>
                <dd className="text-[0.9375rem] font-semibold">{gap(current.minBookableGapMin)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
          <Switch
            checked={form.smartSlots}
            onChange={(checked) => setForm((f) => ({ ...f, smartSlots: checked }))}
            label={t('scheduling.smartSlots')}
            description={form.smartSlots ? explanation(form) : t('scheduling.offText')}
          />
          <div className="flex flex-col gap-1.5">
            <Select
              label={t('scheduling.maxGap')}
              value={String(form.maxGapMin)}
              disabled={!form.smartSlots}
              onChange={(e) => setForm((f) => ({ ...f, maxGapMin: Number(e.target.value) }))}
              options={withValue(MAX_GAPS, form.maxGapMin).map((n) => ({ value: String(n), label: gap(n) }))}
            />
            <p className="pl-1 text-sm text-ink-600">{t('scheduling.maxGapHint')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Select
              label={t('scheduling.minBookableGap')}
              value={String(form.minBookableGapMin)}
              disabled={!form.smartSlots}
              onChange={(e) => setForm((f) => ({ ...f, minBookableGapMin: Number(e.target.value) }))}
              options={withValue(BOOKABLE_GAPS, form.minBookableGapMin).map((n) => ({ value: String(n), label: gap(n) }))}
            />
            <p className="pl-1 text-sm text-ink-600">{t('scheduling.minBookableGapHint')}</p>
          </div>
          {form.smartSlots ? <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">{example}</p> : null}
          {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <Button type="submit" size="md" disabled={!dirty} loading={save.isPending} className="min-w-32">
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
    </section>
  );
}
