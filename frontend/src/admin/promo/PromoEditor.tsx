import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, Checkbox, SegmentedControl, Select, Sheet, Skeleton, Switch, TextField, toast } from '@/components/ui';
import { CasinoIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { isApiError } from '@/services/api/client';
import type { PromoKind } from '@/types/api';
import { adminQueries } from '../api';
import { adminPromoApi, type AdminPromo, type PromoAccess, type PromoInput } from './api';
import { PROMO_CODE, cleanPromoCode, generatePromoCode } from './code';

/** The form as typed: numbers stay text until saved, so a field can be empty meanwhile. */
interface Form {
  code: string;
  kind: PromoKind;
  value: string;
  startsAt: string;
  endsAt: string;
  /** Empty = no limit. */
  maxUses: string;
  maxUsesPerClient: string;
  minTotal: string;
  serviceIds: string[] | null;
  /** Empty = the whole studio. */
  staffId: string;
  firstVisitOnly: boolean;
  isActive: boolean;
  note: string;
}

function initialForm(promo: AdminPromo | null, access: PromoAccess): Form {
  if (!promo) {
    // A new code: 10% off any visit, once per client, until switched off.
    return {
      code: '',
      kind: 'percent',
      value: '10',
      startsAt: '',
      endsAt: '',
      maxUses: '',
      maxUsesPerClient: '1',
      minTotal: '',
      serviceIds: null,
      staffId: access.manage === 'own' ? (access.masterId ?? '') : '',
      firstVisitOnly: false,
      isActive: true,
      note: '',
    };
  }
  return {
    code: promo.code,
    kind: promo.kind,
    value: String(promo.value),
    startsAt: promo.startsAt ?? '',
    endsAt: promo.endsAt ?? '',
    maxUses: promo.maxUses === null ? '' : String(promo.maxUses),
    maxUsesPerClient: String(promo.maxUsesPerClient),
    minTotal: promo.minTotal ? String(promo.minTotal) : '',
    serviceIds: promo.serviceIds,
    staffId: promo.staffId ?? '',
    firstVisitOnly: promo.firstVisitOnly,
    isActive: promo.isActive,
    note: promo.note,
  };
}

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

function toInput(form: Form): PromoInput {
  return {
    code: cleanPromoCode(form.code),
    kind: form.kind,
    value: whole(form.value),
    startsAt: form.startsAt || null,
    endsAt: form.endsAt || null,
    maxUses: form.maxUses.trim() ? whole(form.maxUses) : null,
    maxUsesPerClient: whole(form.maxUsesPerClient),
    minTotal: form.minTotal.trim() ? whole(form.minTotal) : 0,
    serviceIds: form.serviceIds,
    staffId: form.staffId || null,
    firstVisitOnly: form.firstVisitOnly,
    isActive: form.isActive,
    note: form.note.trim(),
  };
}

/** What would be refused, by field, before asking the server (the same rules it applies). */
function issuesOf(input: PromoInput): Record<string, string> {
  const issues: Record<string, string> = {};
  if (!PROMO_CODE.test(input.code)) issues.code = 'invalid_code';
  if (!(input.value >= 1 && input.value <= 100_000)) issues.value = 'invalid';
  else if (input.kind === 'percent' && input.value > 100) issues.value = 'max_percent';
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) issues.endsAt = 'end_before_start';
  if (input.maxUses !== null && !(input.maxUses >= 1 && input.maxUses <= 100_000)) issues.maxUses = 'invalid';
  if (!(input.maxUsesPerClient >= 1 && input.maxUsesPerClient <= 100)) issues.maxUsesPerClient = 'invalid';
  if (!(input.minTotal >= 0 && input.minTotal <= 100_000)) issues.minTotal = 'invalid';
  if (input.serviceIds?.length === 0) issues.serviceIds = 'required';
  return issues;
}

/**
 * Create or edit a promo code: the code (typed or made up in one tap), the discount, the visit
 * days, the limits and conditions, and whose bookings it works on. A master's codes are always
 * their own; a used code keeps its text and can only be switched off, not deleted.
 */
export function PromoEditor({ promo, access, onClose }: { promo: AdminPromo | null; access: PromoAccess; onClose: () => void }) {
  const { t } = useTranslation(['promo', 'admin', 'common']);
  const { locale } = useLocale();
  const { currency } = useStudio();
  const queryClient = useQueryClient();
  const catalog = useQuery(adminQueries.catalog());
  const staff = useQuery(adminQueries.staff());
  const [form, setForm] = useState<Form>(() => initialForm(promo, access));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const name = (text: { ro: string; ru: string; en: string }) => text[locale] || text.ro;
  const unit = currency === 'MDL' ? t('promo:admin.unitMdl') : currency;
  const codeLocked = promo !== null && !promo.canDelete;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'promo'] });
  const save = useMutation({
    mutationFn: () => {
      const input = toInput(form);
      if (!promo) return adminPromoApi.create(input);
      // Send only what changed; a master never moves a code to someone else.
      const before = toInput(initialForm(promo, access));
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof PromoInput])),
      ) as Partial<PromoInput>;
      if (access.manage === 'own') delete changed.staffId;
      return Object.keys(changed).length ? adminPromoApi.update(promo.id, changed) : Promise.resolve(promo);
    },
    onSuccess: () => {
      refresh();
      toast.success(promo ? t('promo:admin.editor.saved') : t('promo:admin.editor.created'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => adminPromoApi.remove(promo!.id),
    onSuccess: () => {
      refresh();
      toast.success(t('promo:admin.editor.deleted'));
      onClose();
    },
  });

  const issues = issuesOf(toInput(form));
  const server = isApiError(save.error) ? save.error.fields : {};
  const issueText = (code: string) =>
    t(`promo:admin.editor.issues.${code}`, { defaultValue: t('promo:admin.editor.issues.invalid') });
  const message = (field: string) => (touched && issues[field] ? issueText(issues[field]!) : server[field] ? issueText(server[field]!) : undefined);
  const unexplained = save.isError && !Object.keys(server).some((field) => field in form);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(issues).length > 0) return;
    save.mutate();
  };

  const masters = (staff.data ?? []).filter((m) => m.isActive || m.id === form.staffId);
  const categories = [...(catalog.data?.categories ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order);
  const services = catalog.data?.services ?? [];
  const toggleService = (id: string, on: boolean) => {
    const current = form.serviceIds ?? [];
    set('serviceIds', on ? [...current, id] : current.filter((s) => s !== id));
  };
  const number = { type: 'number', inputMode: 'numeric', step: 1 } as const;

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={promo ? t('promo:admin.editor.edit', { code: promo.code }) : t('promo:admin.editor.new')}
      description={t('promo:admin.editor.hint')}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" form="promo-form" size="md" loading={save.isPending} className="min-w-32">
            {t('admin:common.save')}
          </Button>
          {promo?.canDelete ? (
            <Button
              size="md"
              variant="ghost"
              className="ml-auto text-red-700"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(t('promo:admin.editor.deleteConfirm', { code: promo.code }))) remove.mutate();
              }}
            >
              {t('promo:admin.editor.delete')}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id="promo-form" className="flex flex-col gap-6 py-2" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-2">
          <TextField
            label={t('promo:admin.editor.code')}
            value={form.code}
            onChange={(e) => set('code', cleanPromoCode(e.target.value))}
            maxLength={20}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={codeLocked}
            hint={codeLocked ? t('promo:admin.editor.used') : t('promo:admin.editor.codeHint')}
            error={message('code')}
          />
          {!codeLocked ? (
            <Button size="sm" variant="soft" icon={CasinoIcon} className="self-start" onClick={() => set('code', generatePromoCode())}>
              {t('promo:admin.editor.generate')}
            </Button>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold text-ink-700">{t('promo:admin.editor.kind')}</legend>
          <SegmentedControl
            label={t('promo:admin.editor.kind')}
            value={form.kind}
            onChange={(kind) => set('kind', kind)}
            options={[
              { value: 'percent', label: t('promo:admin.editor.percent') },
              { value: 'amount', label: t('promo:admin.editor.amount') },
            ]}
            className="w-full sm:w-auto sm:self-start"
          />
          <TextField
            {...number}
            label={form.kind === 'percent' ? t('promo:admin.editor.value') : t('promo:admin.editor.valueAmount', { unit })}
            min={1}
            max={form.kind === 'percent' ? 100 : undefined}
            value={form.value}
            onChange={(e) => set('value', e.target.value)}
            error={message('value')}
            className="sm:max-w-60"
          />
        </fieldset>

        {access.manage === 'all' ? (
          <Select
            label={t('promo:admin.editor.master')}
            value={form.staffId}
            onChange={(e) => set('staffId', e.target.value)}
            error={message('staffId')}
            options={[
              { value: '', label: t('promo:admin.wholeStudio') },
              ...masters.map((m) => ({ value: m.id, label: t('promo:admin.onlyWith', { name: m.name }) })),
            ]}
          />
        ) : (
          <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700">{t('promo:admin.editor.ownHint')}</p>
        )}

        <section aria-labelledby="promo-dates" className="flex flex-col gap-3">
          <div>
            <h3 id="promo-dates" className="text-h3 font-extrabold">
              {t('promo:admin.editor.dates')}
            </h3>
            <p className="mt-0.5 text-sm text-ink-600">{t('promo:admin.editor.datesHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              type="date"
              label={t('promo:admin.editor.startsAt')}
              value={form.startsAt}
              max={form.endsAt || undefined}
              onChange={(e) => set('startsAt', e.target.value)}
            />
            <TextField
              type="date"
              label={t('promo:admin.editor.endsAt')}
              value={form.endsAt}
              min={form.startsAt || undefined}
              onChange={(e) => set('endsAt', e.target.value)}
              error={message('endsAt')}
            />
          </div>
        </section>

        <section aria-labelledby="promo-limits" className="flex flex-col gap-3">
          <h3 id="promo-limits" className="text-h3 font-extrabold">
            {t('promo:admin.editor.limits')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              {...number}
              label={t('promo:admin.editor.maxUses')}
              min={1}
              value={form.maxUses}
              onChange={(e) => set('maxUses', e.target.value)}
              hint={t('promo:admin.editor.maxUsesHint')}
              error={message('maxUses')}
            />
            <TextField
              {...number}
              label={t('promo:admin.editor.maxUsesPerClient')}
              min={1}
              max={100}
              value={form.maxUsesPerClient}
              onChange={(e) => set('maxUsesPerClient', e.target.value)}
              error={message('maxUsesPerClient')}
            />
          </div>
        </section>

        <section aria-labelledby="promo-conditions" className="flex flex-col gap-4">
          <h3 id="promo-conditions" className="text-h3 font-extrabold">
            {t('promo:admin.editor.conditions')}
          </h3>
          <TextField
            {...number}
            label={t('promo:admin.editor.minTotal', { unit })}
            min={0}
            placeholder="0"
            value={form.minTotal}
            onChange={(e) => set('minTotal', e.target.value)}
            hint={t('promo:admin.editor.minTotalHint')}
            error={message('minTotal')}
            className="sm:max-w-60"
          />
          <Switch
            checked={form.firstVisitOnly}
            onChange={(v) => set('firstVisitOnly', v)}
            label={t('promo:admin.editor.firstVisitOnly')}
            description={t('promo:admin.editor.firstVisitOnlyHint')}
          />
          <Switch
            checked={form.serviceIds === null}
            onChange={(all) => set('serviceIds', all ? null : [])}
            label={t('promo:admin.editor.allServices')}
            description={t('promo:admin.editor.allServicesHint')}
          />
          {form.serviceIds !== null ? (
            catalog.isPending ? (
              <Skeleton rounded="xl" className="h-40" />
            ) : catalog.isError ? (
              <Alert>{errorMessage(t, catalog.error)}</Alert>
            ) : (
              <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
                {categories.map((category) => {
                  const list = services.filter((s) => s.categoryId === category.id);
                  if (list.length === 0) return null;
                  return (
                    <fieldset key={category.id} className="flex flex-col gap-2.5">
                      <legend className="mb-1 text-sm font-semibold text-ink-700">{name(category.name)}</legend>
                      {list.map((service) => (
                        <Checkbox
                          key={service.id}
                          checked={form.serviceIds?.includes(service.id) ?? false}
                          onChange={(e) => toggleService(service.id, e.target.checked)}
                          label={
                            <span className="inline-flex flex-wrap items-center gap-2">
                              {name(service.name)}
                              {!service.isActive ? <Badge tone="neutral">{t('admin:services.hidden')}</Badge> : null}
                            </span>
                          }
                        />
                      ))}
                    </fieldset>
                  );
                })}
                {message('serviceIds') ? (
                  <p className="text-sm text-red-600" role="alert">
                    {issues.serviceIds ? t('promo:admin.editor.pickServices') : message('serviceIds')}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
        </section>

        <div className="rounded-2xl bg-ink-50 p-4">
          <Switch
            checked={form.isActive}
            onChange={(v) => set('isActive', v)}
            label={t('promo:admin.editor.active')}
            description={t('promo:admin.editor.activeHint')}
          />
        </div>

        <TextField
          label={`${t('promo:admin.editor.note')} (${t('admin:common.optional')})`}
          placeholder={t('promo:admin.editor.notePlaceholder')}
          maxLength={300}
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          error={message('note')}
        />

        {unexplained ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
        {remove.isError ? <Alert>{errorMessage(t, remove.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}
