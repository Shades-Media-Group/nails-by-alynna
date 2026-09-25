import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Avatar, Badge, Button, Checkbox, Sheet, Skeleton, Switch, TextField, toast } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { SWATCH, SWATCH_ORDER } from '@/lib/swatch';
import { adminApi, adminQueries, type AdminStaff, type StaffInput, type WeeklyHours } from '../api';
import { HoursEditor } from './HoursEditor';
import { I18nFields } from './I18nFields';
import { dayIssue, emptyText, fillFromRo } from './utils';

const DEFAULT_WEEK: WeeklyHours = [0, 1, 2, 3, 4, 5, 6].map((day) => (day < 5 ? [{ start: '10:00', end: '19:00' }] : []));

function initialForm(member: AdminStaff | null): StaffInput {
  if (!member) {
    return { name: '', title: emptyText(), color: 'blush', userId: null, serviceIds: null, weekly: DEFAULT_WEEK, isActive: true, isBookable: true };
  }
  return {
    name: member.name,
    title: member.title,
    color: member.color,
    userId: member.userId,
    serviceIds: member.serviceIds,
    weekly: Array.from({ length: 7 }, (_, day) => member.weekly[day] ?? []),
    isActive: member.isActive,
    isBookable: member.isBookable,
  };
}

/** Add or edit a master (owner only): name, title, colour, what they do and when they work. */
export function StaffEditor({ member, onClose }: { member: AdminStaff | null; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const catalog = useQuery(adminQueries.catalog());
  const [form, setForm] = useState<StaffInput>(() => initialForm(member));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof StaffInput>(key: K, value: StaffInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const name = (text: { ro: string; ru: string; en: string }) => text[locale] || text.ro;

  const categories = [...(catalog.data?.categories ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order);
  const services = catalog.data?.services ?? [];

  const save = useMutation({
    mutationFn: () => {
      const input: StaffInput = {
        ...form,
        name: form.name.trim(),
        title: form.title.ro.trim() ? fillFromRo(form.title) : { ro: '', ru: form.title.ru.trim(), en: form.title.en.trim() },
      };
      if (!member) return adminApi.createStaff(input);
      const before = initialForm(member);
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof StaffInput])),
      ) as Partial<StaffInput>;
      return Object.keys(changed).length ? adminApi.updateStaff(member.id, changed) : Promise.resolve(member);
    },
    onSuccess: () => {
      for (const queryKey of [['admin', 'staff'], ['staff'], ['config'], ['admin', 'stats'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(member ? t('common.saved') : t('team.added'));
      onClose();
    },
  });

  const server = fieldErrors(t, save.error);
  const nameError = touched && !form.name.trim() ? t('common:validation.required') : server.name;
  const hoursInvalid = form.weekly.some((day) => dayIssue(day) !== null);
  const servicesError = touched && form.serviceIds?.length === 0 ? t('team.pickServices') : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!form.name.trim() || hoursInvalid || form.serviceIds?.length === 0) return;
    save.mutate();
  };

  const toggleService = (id: string, on: boolean) => {
    const current = form.serviceIds ?? [];
    set('serviceIds', on ? [...current, id] : current.filter((s) => s !== id));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={member ? t('team.editMaster') : t('team.newMaster')}
      description={t('team.editorHint')}
      footer={
        <Button type="submit" form="staff-form" size="md" loading={save.isPending} className="min-w-32">
          {t('common.save')}
        </Button>
      }
    >
      <form id="staff-form" className="flex flex-col gap-6 py-2" onSubmit={submit} noValidate>
        <div className="flex items-center gap-4">
          <Avatar name={form.name || '·'} color={form.color} size="lg" />
          <TextField
            label={t('team.name')}
            className="flex-1"
            maxLength={60}
            required
            autoComplete="off"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={nameError}
          />
        </div>

        <I18nFields label={t('team.jobTitle')} value={form.title} onChange={(v) => set('title', v)} maxLength={60} />

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-700">{t('team.color')}</legend>
          <div role="radiogroup" aria-label={t('team.color')} className="flex flex-wrap gap-2">
            {SWATCH_ORDER.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={form.color === swatch}
                aria-label={t(`team.colors.${swatch}`)}
                onClick={() => set('color', swatch)}
                className={cx(
                  'press flex size-12 items-center justify-center rounded-xl ring-inset',
                  SWATCH[swatch].field,
                  form.color === swatch ? 'ring-2 ring-ink-900' : 'ring-1 ring-ink-100',
                )}
              >
                <span aria-hidden="true" className={cx('size-5 rounded-pill bg-current', SWATCH[swatch].accent)} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-4 rounded-2xl bg-ink-50 p-4">
          <Switch checked={form.isBookable} onChange={(v) => set('isBookable', v)} label={t('team.bookable')} description={t('team.bookableHint')} />
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label={t('team.active')} description={t('team.activeHint')} />
        </div>

        <section aria-labelledby="staff-services" className="flex flex-col gap-3">
          <h3 id="staff-services" className="text-h3 font-extrabold">
            {t('team.services')}
          </h3>
          <Switch
            checked={form.serviceIds === null}
            onChange={(all) => set('serviceIds', all ? null : services.filter((s) => s.isActive).map((s) => s.id))}
            label={t('team.allServices')}
            description={t('team.allServicesHint')}
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
                              {!service.isActive ? <Badge tone="neutral">{t('services.hidden')}</Badge> : null}
                            </span>
                          }
                        />
                      ))}
                    </fieldset>
                  );
                })}
                {servicesError ? (
                  <p className="text-sm text-red-600" role="alert">
                    {servicesError}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
        </section>

        <section aria-labelledby="staff-hours" className="flex flex-col gap-3">
          <div>
            <h3 id="staff-hours" className="text-h3 font-extrabold">
              {t('team.hours')}
            </h3>
            <p className="mt-0.5 text-sm text-ink-600">{t('team.hoursHint')}</p>
          </div>
          <HoursEditor value={form.weekly} onChange={(weekly) => set('weekly', weekly)} />
          {server.weekly ? <p className="text-sm text-red-600">{server.weekly}</p> : null}
        </section>

        {save.isError && !server.name ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}
