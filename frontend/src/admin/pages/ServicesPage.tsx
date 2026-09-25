import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NailArt } from '@/components/brand/NailArt';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, IconButton, Skeleton } from '@/components/ui';
import { AddIcon, EditIcon, ExpandMoreIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatDuration, formatPrice } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import { adminApi, adminQueries, type AdminCategory, type AdminService } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { CategoryEditor, OriginBadge, ServiceEditor } from '../components/CatalogEditors';

type Editing =
  | { kind: 'service'; service: AdminService | null; categoryId?: string }
  | { kind: 'category'; category: AdminCategory | null }
  | null;

/** The price list as staff manage it: every category and service, hidden ones included. */
export default function ServicesPage() {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { locale } = useLocale();
  const { currency } = useStudio();
  const queryClient = useQueryClient();
  const catalog = useQuery(adminQueries.catalog());
  const [editing, setEditing] = useState<Editing>(null);

  const reorder = useMutation({
    mutationFn: ({ type, ids }: { type: 'category' | 'service'; ids: string[] }) => adminApi.reorder(type, ids),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: adminQueries.catalog().queryKey });
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  const move = <T extends { id: string }>(type: 'category' | 'service', list: T[], index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ type, ids });
  };

  // Visible categories first; hidden ones (like retired placeholders) at the end.
  const categories = [...(catalog.data?.categories ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order);
  const services = catalog.data?.services ?? [];
  const name = (text: { ro: string; ru: string; en: string }) => text[locale] || text.ro;

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('services.title')}
        subtitle={t('services.subtitle')}
        actions={
          <>
            <Button size="sm" variant="outline" icon={AddIcon} onClick={() => setEditing({ kind: 'category', category: null })}>
              {t('services.addCategory')}
            </Button>
            <Button size="sm" icon={AddIcon} onClick={() => setEditing({ kind: 'service', service: null })}>
              {t('services.addService')}
            </Button>
          </>
        }
      />

      <div className="gutter-x mt-6 flex flex-col gap-6 lg:px-0">
        {catalog.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} rounded="xl" className="h-48" />)
        ) : catalog.isError ? (
          <Alert>{errorMessage(t, catalog.error)}</Alert>
        ) : (
          categories.map((category, categoryIndex) => {
            const list = services.filter((s) => s.categoryId === category.id);
            return (
              <section key={category.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100" aria-labelledby={`cat-${category.id}`}>
                <header className={cx('flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3', !category.isActive && 'opacity-60')}>
                  <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', SWATCH[category.color].field)}>
                    <NailArt art="gel" color={category.color} className="w-8" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id={`cat-${category.id}`} className="text-h3 font-extrabold">
                      {name(category.name)}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      <OriginBadge entry={category} />
                      {category.singleChoice ? <Badge tone="cyan">{t('services.singleChoice')}</Badge> : null}
                      {!category.isActive ? <Badge tone="neutral">{t('services.hidden')}</Badge> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton icon={ExpandMoreIcon} label={t('services.moveUp')} size="sm" className="rotate-180" disabled={categoryIndex === 0} onClick={() => move('category', categories, categoryIndex, -1)} />
                    <IconButton icon={ExpandMoreIcon} label={t('services.moveDown')} size="sm" disabled={categoryIndex === categories.length - 1} onClick={() => move('category', categories, categoryIndex, 1)} />
                    <IconButton icon={EditIcon} label={t('services.editCategory')} size="sm" variant="soft" onClick={() => setEditing({ kind: 'category', category })} />
                  </div>
                </header>

                {list.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-ink-500">{t('services.empty')}</p>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {list.map((service, index) => (
                      <li key={service.id} className={cx('flex items-center gap-3 px-4 py-2.5', !service.isActive && 'bg-ink-50/70')}>
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: 'service', service })}
                          className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                        >
                          <span className={cx('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[category.color].field, !service.isActive && 'opacity-50')}>
                            <NailArt art={service.art} color={category.color} className="w-11" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cx('block truncate text-[0.9375rem] font-semibold group-hover:underline', !service.isActive && 'text-ink-500')}>
                              {name(service.name)}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
                              <span className="tabular font-semibold text-ink-900">{formatPrice(t, service.price, currency, service.priceFrom)}</span>
                              <span>{formatDuration(t, service.durationMin)}</span>
                              {service.isPopular ? <Badge tone="rose">{t('booking:home.popular')}</Badge> : null}
                              {!service.isActive ? <Badge tone="neutral">{t('services.hidden')}</Badge> : null}
                              {service.isDefault && service.customized.length > 0 ? <Badge tone="peach">{t('services.edited')}</Badge> : null}
                              {!service.isDefault && !service.isLegacy ? <Badge tone="lilac">{t('services.added')}</Badge> : null}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center">
                          <IconButton icon={ExpandMoreIcon} label={t('services.moveUp')} size="sm" className="rotate-180" disabled={index === 0} onClick={() => move('service', list, index, -1)} />
                          <IconButton icon={ExpandMoreIcon} label={t('services.moveDown')} size="sm" disabled={index === list.length - 1} onClick={() => move('service', list, index, 1)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-ink-100 px-3 py-2">
                  <Button size="sm" variant="ghost" icon={AddIcon} onClick={() => setEditing({ kind: 'service', service: null, categoryId: category.id })}>
                    {t('services.addService')}
                  </Button>
                </div>
              </section>
            );
          })
        )}
      </div>

      {editing?.kind === 'service' ? (
        <ServiceEditor service={editing.service} categories={categories} defaultCategoryId={editing.categoryId} onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === 'category' ? <CategoryEditor category={editing.category} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
