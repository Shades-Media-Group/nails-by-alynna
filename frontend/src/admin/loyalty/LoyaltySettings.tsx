import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, IconButton, Select, Switch, toast } from '@/components/ui';
import { AddIcon, DeleteIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { ordinal } from '@/lib/ordinal';
import { api } from '@/services/api/client';
import type { LoyaltyReward } from '@/types/api';

interface LoyaltyFields {
  loyaltyEnabled: boolean;
  loyaltyCycle: number;
  loyaltyRewards: LoyaltyReward[];
}

const CYCLES = [4, 5, 6, 7, 8, 9, 10, 12];
const PERCENTS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100];

/**
 * Settings → Loyalty card (owner): on/off, visits per card and which visits get a discount.
 * Everyone else sees the rules read-only.
 */
export function LoyaltySettings({ settings, canEdit }: { settings: Record<string, unknown>; canEdit: boolean }) {
  const { t } = useTranslation(['loyalty', 'common']);
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const current: LoyaltyFields = {
    loyaltyEnabled: settings.loyaltyEnabled !== false,
    loyaltyCycle: Number(settings.loyaltyCycle ?? 8),
    loyaltyRewards: (settings.loyaltyRewards as LoyaltyReward[] | undefined) ?? [],
  };
  const [form, setForm] = useState<LoyaltyFields>(current);
  const rewardVisits = form.loyaltyRewards.map((r) => r.visit);
  const invalid = rewardVisits.some((v) => v > form.loyaltyCycle) || new Set(rewardVisits).size !== rewardVisits.length;
  const dirty = JSON.stringify(form) !== JSON.stringify(current);

  const save = useMutation({
    mutationFn: () => api.patch<{ settings: Record<string, unknown> }>('/admin/settings', form).then((r) => r.settings),
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'settings'], updated);
      for (const queryKey of [['config'], ['loyalty'], ['admin', 'loyalty'], ['appointments'], ['admin', 'appointments']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(t('admin.settings.saved'));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid && dirty) save.mutate();
  };
  const setReward = (index: number, patch: Partial<LoyaltyReward>) =>
    setForm((f) => ({ ...f, loyaltyRewards: f.loyaltyRewards.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  const addReward = () =>
    setForm((f) => {
      const free = Array.from({ length: f.loyaltyCycle }, (_, i) => i + 1).find((v) => !f.loyaltyRewards.some((r) => r.visit === v));
      return free ? { ...f, loyaltyRewards: [...f.loyaltyRewards, { visit: free, percent: 10 }] } : f;
    });

  const summary = current.loyaltyRewards.map((r) => t('admin.settings.summary', { ordinal: ordinal(r.visit, locale), percent: r.percent }));

  return (
    <section aria-labelledby="settings-loyalty" className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 id="settings-loyalty" className="text-h2 font-extrabold">
          {t('admin.settings.title')}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t('admin.settings.text')}</p>
      </div>

      {!canEdit ? (
        <dl className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white px-4 ring-1 ring-inset ring-ink-100">
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
            <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{t('admin.settings.cycle')}</dt>
            <dd className="text-[0.9375rem] font-semibold">{current.loyaltyEnabled ? current.loyaltyCycle : t('admin.settings.off')}</dd>
          </div>
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-6">
            <dt className="text-sm text-ink-600 sm:w-56 sm:shrink-0">{t('admin.settings.rewards')}</dt>
            <dd className="text-[0.9375rem] font-semibold first-letter:uppercase">{summary.join(' · ') || t('admin.settings.none')}</dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
          <Switch
            checked={form.loyaltyEnabled}
            onChange={(checked) => setForm((f) => ({ ...f, loyaltyEnabled: checked }))}
            label={t('admin.settings.enabled')}
            description={t('admin.settings.enabledText')}
          />
          <Select
            label={t('admin.settings.cycle')}
            value={String(form.loyaltyCycle)}
            disabled={!form.loyaltyEnabled}
            onChange={(e) => setForm((f) => ({ ...f, loyaltyCycle: Number(e.target.value) }))}
            options={CYCLES.map((n) => ({ value: String(n), label: String(n) }))}
          />
          <fieldset disabled={!form.loyaltyEnabled} className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-ink-700">{t('admin.settings.rewards')}</legend>
            {form.loyaltyRewards.length === 0 ? <p className="text-sm text-ink-600">{t('admin.settings.none')}</p> : null}
            {form.loyaltyRewards.map((reward, index) => (
              <div key={index} className="flex items-end gap-2">
                <Select
                  className="flex-1"
                  label={t('admin.settings.visit')}
                  value={String(reward.visit)}
                  onChange={(e) => setReward(index, { visit: Number(e.target.value) })}
                  options={Array.from({ length: form.loyaltyCycle }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                />
                <Select
                  className="flex-1"
                  label={t('admin.settings.percent')}
                  value={String(reward.percent)}
                  onChange={(e) => setReward(index, { percent: Number(e.target.value) })}
                  options={PERCENTS.map((p) => ({ value: String(p), label: `−${p}%` }))}
                />
                <IconButton
                  icon={DeleteIcon}
                  label={t('admin.settings.remove')}
                  variant="soft"
                  onClick={() => setForm((f) => ({ ...f, loyaltyRewards: f.loyaltyRewards.filter((_, i) => i !== index) }))}
                />
              </div>
            ))}
            {form.loyaltyRewards.length < Math.min(6, form.loyaltyCycle) ? (
              <Button size="sm" variant="ghost" icon={AddIcon} className="self-start" onClick={addReward}>
                {t('admin.settings.add')}
              </Button>
            ) : null}
          </fieldset>
          {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
          <Button type="submit" size="md" className="self-start" loading={save.isPending} disabled={!dirty || invalid}>
            {t('admin.settings.save')}
          </Button>
        </form>
      )}
    </section>
  );
}
