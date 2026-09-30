import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Button, EmptyState, Select, Sheet, Skeleton, TextField, toast } from '@/components/ui';
import { CheckIcon, DeleteIcon, PhotoLibraryIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatDayShort } from '@/lib/format';
import { adminApi, adminQueries, type AdminPhoto, type PhotosParams, type PhotoStorage } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useStudioToday } from '../components/hooks';
import { Pagination } from '../components/Pagination';
import { isDate } from '../components/time';

const SIZES = [0, 150, 250, 400] as const;
const SORTS = ['newest', 'oldest', 'largest'] as const;
type Sort = (typeof SORTS)[number];

/** "184 KB", "1.2 MB", "412 MB", "1 GB" in the page's language. */
function useBytes() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  return (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    const number = (value: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
    if (mb >= 1024) return t('photos.gb', { value: number(mb / 1024, 1) });
    return mb >= 1 ? t('photos.mb', { value: number(mb, mb < 10 ? 1 : 0) }) : t('photos.kb', { value: number(bytes / 1024, 0) });
  };
}

/**
 * Photos (owner): every photo clients added to bookings, how much room they take on the server
 * (1 GB in all; the owner is told past 400 MB), and a way to find the old or big ones and delete
 * them, by date and size.
 */
export default function PhotosPage() {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const bytes = useBytes();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const minKb = Number(params.get('min')) || 0;
  const sort: Sort = (SORTS as readonly string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as Sort) : 'newest';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const filters: PhotosParams = {
    ...(isDate(from) ? { from } : {}),
    ...(isDate(to) ? { to } : {}),
    ...(minKb ? { minKb } : {}),
    sort,
    page,
  };
  const photos = useQuery(adminQueries.photos(filters));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<AdminPhoto | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.delete('page');
    const search = next.toString();
    setSelected(new Set());
    navigate({ pathname, search: search ? `?${search}` : '' }, { replace: true, preventScrollReset: true });
  };

  const remove = useMutation({
    mutationFn: (ids: string[]) => adminApi.deletePhotos(ids),
    onSuccess: ({ deleted }) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'photos'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'appointment'] });
      toast.success(t('photos.deleted', { count: deleted }));
      setSelected(new Set());
      setConfirming(false);
      setViewing(null);
    },
  });

  const list = photos.data?.photos ?? [];
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = list.length > 0 && list.every((photo) => selected.has(photo.id));
  const filtered = Boolean(from || to || minKb);

  return (
    <div className="pb-8">
      <AdminHeader title={t('photos.title')} subtitle={t('photos.subtitle')} />
      <div className="gutter-x mt-6 flex flex-col gap-6 lg:px-0">
        {photos.data ? <StorageCard storage={photos.data.storage} /> : <Skeleton rounded="xl" className="h-28" />}

        <section aria-label={t('photos.filters')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField label={t('photos.from')} type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
          <TextField label={t('photos.to')} type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
          <Select
            label={t('photos.size')}
            value={String(minKb)}
            onChange={(e) => update({ min: e.target.value === '0' ? null : e.target.value })}
            options={SIZES.map((kb) => ({ value: String(kb), label: kb === 0 ? t('photos.anySize') : t('photos.atLeast', { size: bytes(kb * 1024) }) }))}
          />
          <Select
            label={t('photos.sort')}
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })}
            options={SORTS.map((value) => ({ value, label: t(`photos.sorts.${value}`) }))}
          />
        </section>

        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-600">
            {photos.data ? t('photos.found', { count: photos.data.total }) : null}
            {filtered ? (
              <button type="button" className="ml-2 font-semibold text-rose-700 underline underline-offset-4" onClick={() => update({ from: null, to: null, min: null })}>
                {t('photos.clearFilters')}
              </button>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            {list.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setSelected(allOnPage ? new Set() : new Set(list.map((p) => p.id)))}>
                {allOnPage ? t('photos.selectNone') : t('photos.selectPage')}
              </Button>
            ) : null}
            <Button size="sm" variant="danger" icon={DeleteIcon} disabled={selected.size === 0} onClick={() => setConfirming(true)}>
              {selected.size > 0 ? t('photos.deleteCount', { count: selected.size }) : t('photos.delete')}
            </Button>
          </div>
        </div>

        {photos.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} rounded="xl" className="aspect-square" />
            ))}
          </div>
        ) : photos.isError ? (
          <Alert>{errorMessage(t, photos.error)}</Alert>
        ) : list.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            <EmptyState icon={PhotoLibraryIcon} tone="blush" title={filtered ? t('photos.noneFound') : t('photos.empty')} description={t('photos.emptyText')} />
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((photo) => (
              <PhotoTile key={photo.id} photo={photo} selected={selected.has(photo.id)} onToggle={() => toggle(photo.id)} onOpen={() => setViewing(photo)} />
            ))}
          </ul>
        )}

        {photos.data && photos.data.pages > 1 ? (
          <Pagination page={page} pages={photos.data.pages} busy={photos.isFetching} onPage={(next) => update({ page: next === 1 ? null : String(next) })} />
        ) : null}
      </div>

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('photos.deleteTitle', { count: selected.size })}
        description={t('photos.deleteText')}
        confirmLabel={t('photos.delete')}
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate([...selected])}
      />
      <PhotoViewer photo={viewing} onClose={() => setViewing(null)} onDelete={(photo) => remove.mutate([photo.id])} deleting={remove.isPending} />
    </div>
  );
}

/** How much room the photos take, against the 400 MB alert and the 1 GB the server has. */
function StorageCard({ storage }: { storage: PhotoStorage }) {
  const { t } = useTranslation('admin');
  const bytes = useBytes();
  const used = Math.min(1, storage.bytes / storage.quotaBytes);
  const alertAt = storage.alertBytes / storage.quotaBytes;
  const over = storage.bytes >= storage.alertBytes;
  const average = storage.count ? storage.bytes / storage.count : 0;

  return (
    <section aria-labelledby="photos-storage" className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="photos-storage" className="text-h3 font-extrabold">
          {t('photos.used', { used: bytes(storage.bytes), total: bytes(storage.quotaBytes) })}
        </h2>
        <p className="tabular text-sm text-ink-600">
          {t('photos.count', { count: storage.count })}
          {storage.count ? ` · ${t('photos.average', { size: bytes(average) })}` : ''}
        </p>
      </div>
      <div
        className="relative mt-3 h-3 rounded-pill bg-ink-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={storage.quotaBytes}
        aria-valuenow={storage.bytes}
        aria-valuetext={t('photos.used', { used: bytes(storage.bytes), total: bytes(storage.quotaBytes) })}
      >
        <span className={cx('absolute inset-y-0 left-0 rounded-pill', over ? 'bg-red-600' : 'bg-ink-900')} style={{ width: `${Math.max(used * 100, storage.bytes ? 1 : 0)}%` }} />
        <span aria-hidden="true" className="absolute -inset-y-1 w-0.5 rounded-pill bg-peach-500" style={{ left: `${alertAt * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-ink-600">{t('photos.alertAt', { size: bytes(storage.alertBytes) })}</p>
      {over ? (
        <Alert tone="warning" className="mt-3">
          {t('photos.over', { size: bytes(storage.alertBytes) })}
        </Alert>
      ) : null}
    </section>
  );
}

function PhotoTile({ photo, selected, onToggle, onOpen }: { photo: AdminPhoto; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const { t } = useTranslation('admin');
  const { locale, lp } = useLocale();
  const { timeZone } = useStudioToday();
  const bytes = useBytes();
  return (
    <li className={cx('overflow-hidden rounded-2xl bg-white ring-inset', selected ? 'ring-2 ring-ink-900' : 'ring-1 ring-ink-100')}>
      <div className="relative aspect-square bg-ink-50">
        <button type="button" onClick={onOpen} aria-label={t('photos.openNamed', { name: photo.client.name })} className="block size-full">
          <img src={photo.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t('photos.select', { name: photo.client.name })}
          onClick={onToggle}
          className="press absolute left-2 top-2 inline-flex size-9 items-center justify-center rounded-pill"
        >
          <span
            className={cx(
              'inline-flex size-6 items-center justify-center rounded-md text-base ring-2 ring-inset',
              selected ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white/90 text-transparent ring-white',
            )}
          >
            <CheckIcon fontSize="inherit" />
          </span>
        </button>
        <span className="tabular absolute bottom-2 right-2 rounded-pill bg-ink-900/80 px-2 py-0.5 text-xs font-semibold text-white">{bytes(photo.size)}</span>
      </div>
      <div className="p-3 text-sm">
        <p className="truncate font-semibold">{photo.client.name || t('photos.unknownClient')}</p>
        <p className="tabular text-ink-600 first-letter:uppercase">{formatDayShort(photo.createdAt, locale, timeZone)}</p>
        {photo.appointment ? (
          <Link to={lp(`/admin/appointments/${photo.appointment.id}`)} className="font-semibold text-rose-700 underline underline-offset-4">
            {t('photos.booking', { code: photo.appointment.code })}
          </Link>
        ) : (
          <p className="text-ink-500">{t('photos.noBooking')}</p>
        )}
      </div>
    </li>
  );
}

function PhotoViewer({ photo, onClose, onDelete, deleting }: { photo: AdminPhoto | null; onClose: () => void; onDelete: (photo: AdminPhoto) => void; deleting: boolean }) {
  const { t } = useTranslation('admin');
  const bytes = useBytes();
  return (
    <Sheet
      open={photo !== null}
      onClose={onClose}
      size="lg"
      title={photo?.client.name || t('photos.title')}
      description={photo ? `${photo.width} × ${photo.height} · ${bytes(photo.size)}` : undefined}
      footer={
        photo ? (
          <Button size="md" variant="danger" icon={DeleteIcon} loading={deleting} onClick={() => onDelete(photo)}>
            {t('photos.deleteOne')}
          </Button>
        ) : null
      }
    >
      {photo ? (
        <div className="flex justify-center py-2">
          <img src={photo.url} alt="" width={photo.width} height={photo.height} className="max-h-[65dvh] w-auto max-w-full rounded-xl bg-ink-50 object-contain" />
        </div>
      ) : null}
    </Sheet>
  );
}

