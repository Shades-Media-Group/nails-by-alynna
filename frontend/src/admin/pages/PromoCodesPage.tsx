import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, Chip, EmptyState, IconButton, Skeleton, toast, type BadgeTone } from '@/components/ui';
import { AddIcon, ContentCopyIcon, EditIcon, LocalOfferIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import type { Locale } from '@/i18n/config';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { formatPromoDay, promoValueText } from '@/lib/promo';
import { adminQueries, type AdminStaff } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { adminPromoQueries, type AdminPromo, type PromoAccess, type PromoStatus } from '../promo/api';
import { PromoEditor } from '../promo/PromoEditor';

const STATUSES: PromoStatus[] = ['active', 'scheduled', 'expired', 'used_up', 'off'];
const STATUS_TONE: Record<PromoStatus, BadgeTone> = { active: 'mint', scheduled: 'cyan', expired: 'neutral', used_up: 'peach', off: 'neutral' };

/** "1 October – 31 October", "From 1 October", "Until 31 October" or "Any day". */
function datesText(t: TFunction, p: AdminPromo, locale: Locale): string {
  const day = (date: string) => formatPromoDay(date, locale);
  if (p.startsAt && p.endsAt) return t('promo:admin.dates.range', { from: day(p.startsAt), to: day(p.endsAt) });
  if (p.startsAt) return t('promo:admin.dates.from', { date: day(p.startsAt) });
  if (p.endsAt) return t('promo:admin.dates.until', { date: day(p.endsAt) });
  return t('promo:admin.dates.any');
}

/**
 * Promo codes (route /admin/promo): every code with where it stands today and how much of it is
 * used ("3 / 20"). The owner manages all of them, a master only their own (they work only on
 * bookings with them), other staff see them read-only.
 */
export default function PromoCodesPage() {
  const { t } = useTranslation(['promo', 'admin', 'common']);
  const list = useQuery(adminPromoQueries.list());
  const staff = useQuery(adminQueries.staff());
  const [filter, setFilter] = useState<PromoStatus | null>(null);
  const [editing, setEditing] = useState<{ promo: AdminPromo | null } | null>(null);

  const access = list.data?.access;
  const canManage = access !== undefined && access.manage !== 'none';
  const promos = list.data?.promos ?? [];
  const counts = new Map<PromoStatus, number>();
  for (const p of promos) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  const shown = filter ? promos.filter((p) => p.status === filter) : promos;
  const subtitle =
    access?.manage === 'all' ? t('admin.subtitleOwner') : access?.manage === 'own' ? t('admin.subtitleMaster') : t('admin.subtitleStaff');
  const create = () => setEditing({ promo: null });

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('admin.title')}
        subtitle={access ? subtitle : undefined}
        actions={
          canManage ? (
            <Button size="sm" icon={AddIcon} onClick={create}>
              {t('admin.new')}
            </Button>
          ) : null
        }
      />

      <div className="gutter-x mt-6 flex flex-col gap-4 lg:px-0">
        {list.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-24" />
            ))}
          </div>
        ) : list.isError ? (
          <Alert>{errorMessage(t, list.error)}</Alert>
        ) : promos.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            <EmptyState
              icon={LocalOfferIcon}
              tone="cyan"
              title={t('admin.empty')}
              description={
                access?.manage === 'all' ? t('admin.emptyOwner') : access?.manage === 'own' ? t('admin.emptyMaster') : t('admin.emptyStaff')
              }
              action={
                canManage ? (
                  <Button size="md" icon={AddIcon} onClick={create}>
                    {t('admin.new')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div role="group" aria-label={t('admin.filter')} className="no-scrollbar -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] lg:mx-0 lg:px-0">
              <Chip selected={filter === null} count={promos.length} onClick={() => setFilter(null)}>
                {t('admin.all')}
              </Chip>
              {STATUSES.filter((s) => counts.has(s) || filter === s).map((s) => (
                <Chip key={s} selected={filter === s} count={counts.get(s) ?? 0} onClick={() => setFilter(s)}>
                  {t(`admin.status.${s}`)}
                </Chip>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-ink-600 ring-1 ring-inset ring-ink-100">{t('admin.emptyFilter')}</p>
            ) : (
              <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
                {shown.map((promo) => (
                  <PromoRow
                    key={promo.id}
                    promo={promo}
                    access={access!}
                    masters={staff.data ?? []}
                    onEdit={canManage ? () => setEditing({ promo }) : undefined}
                  />
                ))}
              </ul>
            )}
            <p className="text-sm text-ink-600">
              {t('admin.stacking')}
              {!canManage ? ` ${t('admin.readOnly')}` : ''}
            </p>
          </>
        )}
      </div>

      {editing && access ? <PromoEditor promo={editing.promo} access={access} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** One code: the code itself, where it stands, the discount, "3 / 20" uses, its days and conditions. */
function PromoRow({ promo: p, access, masters, onEdit }: { promo: AdminPromo; access: PromoAccess; masters: AdminStaff[]; onEdit?: () => void }) {
  const { t } = useTranslation(['promo', 'common']);
  const { locale } = useLocale();
  const { currency } = useStudio();
  const master = p.staffId ? masters.find((m) => m.id === p.staffId) : null;
  const usage =
    p.maxUses === null
      ? t('admin.usageNoLimit', { used: p.usedCount })
      : t('admin.usage', { used: p.usedCount, max: p.maxUses });
  const conditions = [
    // A master's list holds only their own codes: saying so on each row adds nothing.
    access.manage !== 'own' ? (master ? t('admin.onlyWith', { name: master.name }) : p.staffId ? null : t('admin.wholeStudio')) : null,
    p.firstVisitOnly ? t('admin.firstVisit') : null,
    p.minTotal > 0 ? t('admin.minTotal', { amount: formatPrice(t, p.minTotal, currency) }) : null,
    p.serviceIds ? t('admin.services', { count: p.serviceIds.length }) : null,
    t('admin.perClient', { count: p.maxUsesPerClient }),
  ].filter((line): line is string => Boolean(line));
  const faded = p.status === 'off' || p.status === 'expired';

  const copy = () => {
    navigator.clipboard?.writeText(p.code).then(
      () => toast.success(t('admin.copied')),
      () => undefined,
    );
  };

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-xl', faded ? 'bg-ink-50 text-ink-500' : 'bg-cyan-50 text-cyan-800')}
      >
        <LocalOfferIcon fontSize="inherit" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx('break-all text-[1.0625rem] font-extrabold tracking-[0.06em]', faded && 'text-ink-500')}>{p.code}</span>
          <Badge tone={STATUS_TONE[p.status]}>{t(`admin.status.${p.status}`)}</Badge>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm text-ink-600">
          <span className={cx('tabular font-bold', faded ? 'text-ink-600' : 'text-rose-700')}>{promoValueText(t, p.kind, p.value, currency)}</span>
          <span className="tabular">
            {t('admin.usageLabel')} <span className="font-semibold text-ink-800">{usage}</span>
          </span>
          <span>{datesText(t, p, locale)}</span>
        </span>
        <span className="mt-1 block text-xs text-ink-600">{conditions.join(' · ')}</span>
        {p.note ? <span className="mt-1 block break-words text-xs text-ink-500">{p.note}</span> : null}
      </span>
      {onEdit ? (
        <span aria-hidden="true" className="hidden size-9 shrink-0 items-center justify-center rounded-pill bg-ink-50 text-lg text-ink-700 group-hover:bg-ink-100 sm:inline-flex">
          <EditIcon fontSize="inherit" />
        </span>
      ) : null}
    </>
  );

  return (
    <li className="flex items-center gap-1 pr-1">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('admin.editor.edit', { code: p.code })}
          className="press group flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3 text-left hover:bg-ink-50 focus-visible:bg-ink-50"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 p-3">{body}</div>
      )}
      <IconButton icon={ContentCopyIcon} label={t('admin.copy', { code: p.code })} size="sm" onClick={copy} />
    </li>
  );
}
