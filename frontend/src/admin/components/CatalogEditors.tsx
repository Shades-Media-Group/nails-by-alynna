import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NailArt } from '@/components/brand/NailArt';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, Select, Sheet, Switch, TextField, toast } from '@/components/ui';
import { CheckIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { ART_GROUPS } from '@/lib/art';
import { cx } from '@/lib/cx';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { SWATCH, SWATCH_ORDER, type SwatchColor } from '@/lib/swatch';
import type { ServiceArt } from '@/types/api';
import { adminApi, adminQueries, type AdminCategory, type AdminService, type CategoryInput, type ServiceInput } from '../api';
import { I18nFields } from './I18nFields';
import { emptyText, fillFromRo } from './utils';

/** The illustration collection, grouped, drawn in the category's colour. */
function ArtPicker({ value, color, onChange }: { value: ServiceArt; color: SwatchColor; onChange: (art: ServiceArt) => void }) {
  const { t } = useTranslation('admin');
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink-700">{t('services.image')}</legend>
      <div className="flex flex-col gap-3">
        {ART_GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 text-xs font-medium text-ink-500">{t(`services.groups.${group.key}`)}</p>
            <div role="radiogroup" aria-label={t(`services.groups.${group.key}`)} className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {group.arts.map((art) => {
                const selected = art === value;
                return (
                  <button
                    key={art}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={art}
                    onClick={() => onChange(art)}
                    className={cx(
                      'press relative flex aspect-square items-center justify-center rounded-xl p-1.5 ring-inset transition-shadow',
                      SWATCH[color].field,
                      selected ? 'ring-2 ring-ink-900' : 'ring-1 ring-transparent hover:ring-ink-300',
                    )}
                  >
                    <NailArt art={art} color={color} className="w-full" />
                    {selected ? (
                      <span className="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-pill bg-ink-900 text-xs text-white animate-pop">
                        <CheckIcon fontSize="inherit" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function useCatalogRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminQueries.catalog().queryKey });
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
  };
}

/** Where an entry came from, as a quiet label (the price list, edited, or added by the studio). */
export function OriginBadge({ entry }: { entry: { isDefault: boolean; isLegacy: boolean; customized: string[] } }) {
  const { t } = useTranslation('admin');
  if (entry.isLegacy) return <Badge tone="neutral">{t('services.legacy')}</Badge>;
  if (!entry.isDefault) return <Badge tone="lilac">{t('services.added')}</Badge>;
  return entry.customized.length > 0 ? <Badge tone="peach">{t('services.edited')}</Badge> : <Badge tone="neutral">{t('services.fromList')}</Badge>;
}

export function ServiceEditor({
  service,
  categories,
  defaultCategoryId,
  onClose,
}: {
  service: AdminService | null;
  categories: AdminCategory[];
  defaultCategoryId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const refresh = useCatalogRefresh();
  const [form, setForm] = useState<ServiceInput>(() =>
    service
      ? {
          categoryId: service.categoryId,
          name: service.name,
          description: service.description,
          durationMin: service.durationMin,
          price: service.price,
          priceFrom: service.priceFrom,
          art: service.art,
          isPopular: service.isPopular,
          isActive: service.isActive,
        }
      : {
          categoryId: defaultCategoryId ?? categories[0]?.id ?? '',
          name: emptyText(),
          description: emptyText(),
          durationMin: 60,
          price: 0,
          priceFrom: false,
          art: 'gel',
          isPopular: false,
          isActive: true,
        },
  );
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ServiceInput>(key: K, value: ServiceInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const color = categories.find((c) => c.id === form.categoryId)?.color ?? 'blush';

  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, name: fillFromRo(form.name), description: fillFromRo(form.description) };
      if (!service) return adminApi.createService(input);
      // Send only what changed, so untouched fields keep following the price list.
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(service[key as keyof AdminService])),
      ) as Partial<ServiceInput>;
      return Object.keys(changed).length ? adminApi.updateService(service.id, changed) : Promise.resolve(service);
    },
    onSuccess: () => {
      refresh();
      toast.success(t('common.saved'));
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => adminApi.resetService(service!.id),
    onSuccess: () => {
      refresh();
      toast.success(t('services.resetDone'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteService(service!.id),
    onSuccess: (result) => {
      refresh();
      toast.success(result.archived ? t('services.archived') : t('services.deleted'));
      onClose();
    },
  });

  const nameError = touched && !form.name.ro.trim() ? t('common:validation.required') : undefined;
  const server = fieldErrors(t, save.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!form.name.ro.trim() || form.price < 0 || form.durationMin < 5) return;
    save.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={service ? t('services.editService') : t('services.newService')}
      description={service?.isDefault ? t('services.customizedHint') : t('services.languagesHint')}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" form="service-form" size="md" loading={save.isPending} className="min-w-32">
            {t('common.save')}
          </Button>
          {service?.isDefault && service.customized.length > 0 ? (
            <Button size="md" variant="soft" loading={reset.isPending} onClick={() => reset.mutate()}>
              {t('services.reset')}
            </Button>
          ) : null}
          {service ? (
            <Button
              size="md"
              variant="ghost"
              className="ml-auto text-red-700"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(t('services.deleteConfirm', { name: service.name.ro }))) remove.mutate();
              }}
            >
              {t('services.delete')}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id="service-form" className="flex flex-col gap-5 py-2" onSubmit={submit} noValidate>
        {service ? (
          <div className="flex items-center gap-2">
            <OriginBadge entry={service} />
            {!service.isActive ? <Badge tone="neutral">{t('services.hidden')}</Badge> : null}
          </div>
        ) : null}
        <Select
          label={t('services.category')}
          value={form.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          options={categories.map((c) => ({ value: c.id, label: c.name[locale] || c.name.ro }))}
        />
        <I18nFields label={t('services.name')} value={form.name} onChange={(v) => set('name', v)} required maxLength={80} error={nameError ?? server['name.ro']} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('services.price')}
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            value={String(form.price)}
            onChange={(e) => set('price', Math.max(0, Math.round(Number(e.target.value) || 0)))}
            error={server.price}
          />
          <TextField
            label={t('services.duration')}
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            value={String(form.durationMin)}
            onChange={(e) => set('durationMin', Math.round(Number(e.target.value) || 0))}
            error={touched && form.durationMin < 5 ? t('common:validation.required') : server.durationMin}
          />
        </div>
        <Switch checked={form.priceFrom} onChange={(v) => set('priceFrom', v)} label={t('services.priceFrom')} />
        <ArtPicker value={form.art} color={color} onChange={(art) => set('art', art)} />
        <I18nFields label={t('services.description')} value={form.description} onChange={(v) => set('description', v)} multiline maxLength={400} />
        <div className="flex flex-col gap-3 rounded-2xl bg-ink-50 p-4">
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label={t('services.visible')} />
          <Switch checked={form.isPopular} onChange={(v) => set('isPopular', v)} label={t('services.popular')} />
        </div>
        {save.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
        {remove.isError ? <Alert>{errorMessage(t, remove.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}

export function CategoryEditor({ category, onClose }: { category: AdminCategory | null; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const refresh = useCatalogRefresh();
  const [form, setForm] = useState<CategoryInput>(() =>
    category
      ? {
          name: category.name,
          description: category.description ?? emptyText(),
          singleChoice: category.singleChoice,
          color: category.color,
          isActive: category.isActive,
        }
      : { name: emptyText(), description: emptyText(), singleChoice: false, color: 'blush', isActive: true },
  );
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof CategoryInput>(key: K, value: CategoryInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const description = form.description && Object.values(form.description).some((v) => v.trim()) ? fillFromRo(form.description) : null;
      const input: CategoryInput = { ...form, name: fillFromRo(form.name), description };
      if (!category) return adminApi.createCategory(input);
      const changed = Object.fromEntries(
        Object.entries(input).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(category[key as keyof AdminCategory] ?? null)),
      ) as Partial<CategoryInput>;
      return Object.keys(changed).length ? adminApi.updateCategory(category.id, changed) : Promise.resolve(category);
    },
    onSuccess: () => {
      refresh();
      toast.success(t('common.saved'));
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () => adminApi.resetCategory(category!.id),
    onSuccess: () => {
      refresh();
      toast.success(t('services.resetDone'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteCategory(category!.id),
    onSuccess: () => {
      refresh();
      toast.success(t('services.deleted'));
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!form.name.ro.trim()) return;
    save.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={category ? t('services.editCategory') : t('services.newCategory')}
      description={t('services.languagesHint')}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" form="category-form" size="md" loading={save.isPending} className="min-w-32">
            {t('common.save')}
          </Button>
          {category?.isDefault && category.customized.length > 0 ? (
            <Button size="md" variant="soft" loading={reset.isPending} onClick={() => reset.mutate()}>
              {t('services.reset')}
            </Button>
          ) : null}
          {category ? (
            <Button
              size="md"
              variant="ghost"
              className="ml-auto text-red-700"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(t('services.deleteConfirm', { name: category.name.ro }))) remove.mutate();
              }}
            >
              {t('services.deleteCategory')}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id="category-form" className="flex flex-col gap-5 py-2" onSubmit={submit} noValidate>
        <I18nFields
          label={t('services.name')}
          value={form.name}
          onChange={(v) => set('name', v)}
          required
          maxLength={60}
          error={touched && !form.name.ro.trim() ? t('common:validation.required') : undefined}
        />
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-700">{t('services.color')}</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {SWATCH_ORDER.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={form.color === swatch}
                aria-label={swatch}
                onClick={() => set('color', swatch)}
                className={cx(
                  'press flex size-12 items-center justify-center rounded-xl ring-inset',
                  SWATCH[swatch].field,
                  form.color === swatch ? 'ring-2 ring-ink-900' : 'ring-1 ring-ink-100',
                )}
              >
                <NailArt art="gel" color={swatch} className="w-9" />
              </button>
            ))}
          </div>
        </fieldset>
        <I18nFields label={t('services.categoryDescription')} value={form.description ?? emptyText()} onChange={(v) => set('description', v)} multiline maxLength={300} />
        <div className="flex flex-col gap-3 rounded-2xl bg-ink-50 p-4">
          <Switch checked={form.singleChoice} onChange={(v) => set('singleChoice', v)} label={t('services.singleChoice')} />
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label={t('services.visible')} />
        </div>
        {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
        {remove.isError ? <Alert>{errorMessage(t, remove.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}
