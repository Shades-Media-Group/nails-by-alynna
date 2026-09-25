import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Chip, EmptyState, Skeleton } from '@/components/ui';
import {
  AdminIcon,
  ChevronRightIcon,
  EventIcon,
  GroupIcon,
  HistoryIcon,
  PersonIcon,
  SettingsIcon,
  ShieldIcon,
  SpaIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { addDays, dateToInstant, formatDayLong, formatDuration, formatPrice, formatTime, fullName, zonedDate } from '@/lib/format';
import { adminQueries, type AuditEntry } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { useStudioToday } from '../components/hooks';
import { relativeTime } from '../components/utils';

const LIMIT = 200;

type Area = 'appointments' | 'clients' | 'catalog' | 'team' | 'settings' | 'users' | 'auth';
const AREAS: Area[] = ['appointments', 'clients', 'catalog', 'team', 'settings', 'users', 'auth'];

const AREA_STYLE: Record<Area, { icon: IconComponent; tone: string }> = {
  appointments: { icon: EventIcon, tone: 'bg-blush-100 text-rose-700' },
  clients: { icon: GroupIcon, tone: 'bg-cyan-50 text-cyan-800' },
  catalog: { icon: SpaIcon, tone: 'bg-lilac-50 text-lilac-700' },
  team: { icon: PersonIcon, tone: 'bg-mint-50 text-mint-700' },
  settings: { icon: SettingsIcon, tone: 'bg-ink-100 text-ink-800' },
  users: { icon: AdminIcon, tone: 'bg-peach-50 text-peach-800' },
  auth: { icon: ShieldIcon, tone: 'bg-ink-100 text-ink-800' },
};

function areaOf(action: string): Area {
  const [kind] = action.split('.');
  if (kind === 'appointment') return 'appointments';
  if (kind === 'client' || kind === 'loyalty') return 'clients';
  if (kind === 'service' || kind === 'category') return 'catalog';
  if (kind === 'staff' || kind === 'time_off') return 'team';
  if (kind === 'settings') return 'settings';
  if (action === 'user.role_change' || action === 'user.status_change') return 'users';
  return 'auth';
}

const CLIENT_TARGETS = new Set(['user.register', 'user.register_google', 'user.claim_invite', 'user.claim_invite_google']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fromTo = (value: unknown): { from: number; to: number } | null =>
  isRecord(value) && typeof value.from === 'number' && typeof value.to === 'number' ? { from: value.from, to: value.to } : null;

/** The details that make an entry readable: status from → to, price from → to, fields changed. */
function metaLines(entry: AuditEntry, t: TFunction, currency: string): string[] {
  const m = entry.meta;
  const lines: string[] = [];
  const field = (key: string) => t(`audit.fields.${key}`, { defaultValue: t(`settings.fields.${key}`, { defaultValue: key }) });
  if (entry.action === 'appointment.status' && typeof m.from === 'string' && typeof m.to === 'string') {
    lines.push(`${t(`status.${m.from}`, { defaultValue: m.from })} → ${t(`status.${m.to}`, { defaultValue: m.to })}`);
  }
  if (entry.action === 'user.role_change' && typeof m.from === 'string' && typeof m.to === 'string') {
    lines.push(`${t(`roles.${m.from}`, { defaultValue: m.from })} → ${t(`roles.${m.to}`, { defaultValue: m.to })}`);
  }
  if (typeof m.isActive === 'boolean') lines.push(m.isActive ? t('audit.meta.activated') : t('audit.meta.deactivated'));
  const price = fromTo(m.price);
  if (price) lines.push(t('audit.meta.price', { from: formatPrice(t, price.from, currency), to: formatPrice(t, price.to, currency) }));
  const duration = fromTo(m.durationMin);
  if (duration) lines.push(t('audit.meta.duration', { from: formatDuration(t, duration.from), to: formatDuration(t, duration.to) }));
  if (Array.isArray(m.fields)) {
    const rest = m.fields.filter((f): f is string => typeof f === 'string' && !(f === 'price' && price) && !(f === 'durationMin' && duration));
    if (rest.length > 0) lines.push(t('audit.meta.fields', { fields: rest.map(field).join(', ') }));
  }
  if (typeof m.count === 'number') lines.push(t('audit.meta.count', { count: m.count }));
  if (typeof m.delta === 'number') lines.push(m.delta > 0 ? t('audit.meta.stampAdded') : t('audit.meta.stampRemoved'));
  if (entry.action.startsWith('loyalty.') && typeof m.visits === 'number') lines.push(t('audit.meta.stamps', { count: m.visits }));
  if (typeof m.reason === 'string' && m.reason.trim()) lines.push(t('audit.meta.reason', { reason: m.reason.trim() }));
  if (typeof m.ip === 'string' && m.ip) lines.push(t('audit.meta.ip', { ip: m.ip }));
  if (m.passwordRemoved === true) lines.push(t('audit.meta.passwordRemoved'));
  return lines;
}

/** Where an entry's subject can be opened, when it has a screen. */
function targetLink(entry: AuditEntry, lp: (path: string) => string, t: TFunction): { to: string; label: string } | null {
  if (!entry.targetId && entry.targetType !== 'settings') return null;
  if (entry.targetType === 'appointment') return { to: lp(`/admin/appointments/${entry.targetId}`), label: t('audit.open.appointment') };
  if (entry.targetType === 'user' && (entry.action.startsWith('client.') || entry.action.startsWith('loyalty.') || CLIENT_TARGETS.has(entry.action))) {
    return { to: lp(`/admin/clients/${entry.targetId}`), label: t('audit.open.client') };
  }
  if (entry.targetType === 'service' || entry.targetType === 'category') return { to: lp('/admin/services'), label: t('audit.open.catalog') };
  if (entry.targetType === 'staff' || entry.targetType === 'time_off') return { to: lp('/admin/team'), label: t('audit.open.team') };
  if (entry.targetType === 'settings') return { to: lp('/admin/settings'), label: t('audit.open.settings') };
  return null;
}

/** What happened, by whom and when (owner only), newest first, filterable by area. */
export default function AuditPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { lp, locale } = useLocale();
  const { currency } = useStudio();
  const { today, now, timeZone } = useStudioToday();
  const logs = useQuery(adminQueries.audit(LIMIT));
  const [area, setArea] = useState<Area | null>(null);

  const entries = logs.data ?? [];
  const counts = new Map<Area, number>();
  for (const entry of entries) counts.set(areaOf(entry.action), (counts.get(areaOf(entry.action)) ?? 0) + 1);
  const shown = area ? entries.filter((e) => areaOf(e.action) === area) : entries;

  const days: Array<{ date: string; items: AuditEntry[] }> = [];
  for (const entry of shown) {
    const date = zonedDate(new Date(entry.at), timeZone);
    const last = days.at(-1);
    if (last && last.date === date) last.items.push(entry);
    else days.push({ date, items: [entry] });
  }
  const dayTitle = (date: string) =>
    date === today ? t('common:time.today') : date === addDays(today, -1) ? t('audit.yesterday') : formatDayLong(dateToInstant(date), locale, 'UTC');

  return (
    <div className="pb-8">
      <AdminHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <div className="gutter-x mt-6 flex flex-col gap-5 lg:px-0">
        <div role="group" aria-label={t('audit.filter')} className="no-scrollbar -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          <Chip selected={area === null} onClick={() => setArea(null)} count={logs.data ? entries.length : undefined}>
            {t('audit.areas.all')}
          </Chip>
          {AREAS.map((a) => (
            <Chip key={a} selected={area === a} onClick={() => setArea(a)} count={logs.data ? (counts.get(a) ?? 0) : undefined}>
              {t(`audit.areas.${a}`)}
            </Chip>
          ))}
        </div>

        {logs.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-16" />
            ))}
          </div>
        ) : logs.isError ? (
          <Alert>{errorMessage(t, logs.error)}</Alert>
        ) : days.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            <EmptyState icon={HistoryIcon} tone="lilac" title={area ? t('audit.emptyArea') : t('audit.empty')} />
          </div>
        ) : (
          <>
            {days.map((day) => (
              <section key={day.date} aria-labelledby={`audit-${day.date}`} className="flex flex-col gap-2">
                <h2 id={`audit-${day.date}`} className="px-1 text-sm font-semibold text-ink-600 first-letter:uppercase">
                  {dayTitle(day.date)}
                </h2>
                <ul className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
                  {day.items.map((entry) => {
                    const style = AREA_STYLE[areaOf(entry.action)];
                    const lines = metaLines(entry, t, currency);
                    const link = targetLink(entry, lp, t);
                    return (
                      <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                        <span className={cx('mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-lg', style.tone)}>
                          <style.icon fontSize="inherit" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <p className="font-semibold">{t(`audit.actions.${entry.action}`, { defaultValue: entry.action })}</p>
                            <time dateTime={entry.at} title={new Date(entry.at).toLocaleString(locale)} className="tabular shrink-0 text-xs text-ink-500">
                              {relativeTime(entry.at, locale, now)} · {formatTime(entry.at, locale, timeZone)}
                            </time>
                          </div>
                          <p className="text-sm text-ink-600">
                            {entry.actor ? `${fullName(entry.actor)} · ${t(`roles.${entry.actor.role}`)}` : t('audit.system')}
                          </p>
                          {lines.length > 0 ? (
                            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-800">
                              {lines.map((line) => (
                                <li key={line} className="tabular">
                                  {line}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {link ? (
                            <Link
                              to={link.to}
                              className="group mt-1 inline-flex items-center gap-0.5 rounded-pill text-sm font-semibold text-rose-700 hover:text-rose-600"
                            >
                              {link.label}
                              <ChevronRightIcon fontSize="inherit" className="text-base transition-transform duration-200 group-hover:translate-x-0.5" />
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {entries.length >= LIMIT ? <p className="text-center text-sm text-ink-500">{t('audit.limit', { count: LIMIT })}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
