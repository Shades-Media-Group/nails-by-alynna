import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Avatar, Badge, Button, EmptyState, IconButton, Skeleton, toast } from '@/components/ui';
import { AddIcon, DeleteIcon, EditIcon, EventBusyIcon, StorefrontIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { addDays, dateToInstant, formatDayLong, formatDayShort } from '@/lib/format';
import { adminApi, adminQueries, type AdminStaff, type TimeOff } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useStudioToday } from '../components/hooks';
import { StaffEditor } from '../components/StaffEditor';
import { TimeOffEditor } from '../components/TimeOffEditor';
import { zonedParts } from '../components/time';
import { weekdayName, weekSummary } from '../components/utils';

/** The masters (who they are, what they do, when they work) and the time off ahead. */
export default function TeamPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { user } = useAuth();
  const isOwner = user?.role === 'administrator';
  const { today, now } = useStudioToday();
  const queryClient = useQueryClient();
  const staff = useQuery(adminQueries.staff());
  const timeOff = useQuery(adminQueries.timeOff({ from: today, to: addDays(today, 365) }));
  const [editing, setEditing] = useState<{ member: AdminStaff | null } | null>(null);
  const [addingOff, setAddingOff] = useState(false);
  const [removing, setRemoving] = useState<TimeOff | null>(null);

  const remove = useMutation({
    mutationFn: (entry: TimeOff) => adminApi.deleteTimeOff(entry.id),
    onSuccess: () => {
      for (const queryKey of [['admin', 'time-off'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(t('timeOff.deleted'));
      setRemoving(null);
    },
  });

  const members = [...(staff.data ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order);
  const activeMasters = members.filter((m) => m.isActive);
  const entries = (timeOff.data ?? []).filter((o) => new Date(o.end).getTime() > now);

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('team.title')}
        subtitle={isOwner ? t('team.subtitleOwner') : t('team.subtitle')}
        actions={
          isOwner ? (
            <Button size="sm" icon={AddIcon} onClick={() => setEditing({ member: null })}>
              {t('team.add')}
            </Button>
          ) : null
        }
      />

      <div className="gutter-x mt-6 flex flex-col gap-10 lg:px-0">
        <section aria-labelledby="masters-title">
          <SectionHeading id="masters-title" title={t('team.masters')} />
          {staff.isPending ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} rounded="xl" className="h-44" />
              ))}
            </div>
          ) : staff.isError ? (
            <Alert>{errorMessage(t, staff.error)}</Alert>
          ) : members.length === 0 ? (
            <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
              <EmptyState
                icon={AddIcon}
                title={t('team.empty')}
                description={isOwner ? t('team.emptyOwner') : t('team.emptyText')}
                action={
                  isOwner ? (
                    <Button size="md" icon={AddIcon} onClick={() => setEditing({ member: null })}>
                      {t('team.add')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {members.map((member) => (
                  <li key={member.id}>
                    <MasterCard member={member} onEdit={isOwner ? () => setEditing({ member }) : undefined} />
                  </li>
                ))}
              </ul>
              {!isOwner ? <p className="mt-3 text-sm text-ink-600">{t('team.ownerOnly')}</p> : null}
            </>
          )}
        </section>

        <section aria-labelledby="time-off-title">
          <SectionHeading
            id="time-off-title"
            title={t('timeOff.title')}
            action={
              <Button size="sm" variant="outline" icon={AddIcon} disabled={!staff.data} onClick={() => setAddingOff(true)}>
                {t('timeOff.add')}
              </Button>
            }
          />
          <p className="-mt-1 mb-3 text-sm text-ink-600">{t('timeOff.subtitle')}</p>
          {timeOff.isPending ? (
            <Skeleton rounded="xl" className="h-32" />
          ) : timeOff.isError ? (
            <Alert>{errorMessage(t, timeOff.error)}</Alert>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
              <EmptyState icon={EventBusyIcon} tone="cyan" title={t('timeOff.empty')} description={t('timeOff.emptyText')} />
            </div>
          ) : (
            <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
              {entries.map((entry) => (
                <TimeOffRow
                  key={entry.id}
                  entry={entry}
                  member={members.find((m) => m.id === entry.staffId)}
                  now={now}
                  onDelete={isOwner || entry.staffId !== null ? () => setRemoving(entry) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing ? <StaffEditor member={editing.member} onClose={() => setEditing(null)} /> : null}
      {addingOff ? <TimeOffEditor masters={activeMasters} canCloseStudio={isOwner} today={today} onClose={() => setAddingOff(false)} /> : null}
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={removing?.staffId === null ? t('timeOff.deleteStudioTitle') : t('timeOff.deleteTitle')}
        description={t('timeOff.deleteText')}
        confirmLabel={t('timeOff.delete')}
        loading={remove.isPending}
        error={remove.error}
      />
    </div>
  );
}

function MasterCard({ member, onEdit }: { member: AdminStaff; onEdit?: () => void }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const pick = useI18nText();
  const summary = weekSummary(member.weekly, locale);
  const body = (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={member.name} color={member.color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-h3 font-extrabold">{member.name}</p>
          <p className="text-sm text-ink-600">{pick(member.title) || t('team.noTitle')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!member.isActive ? (
              <Badge tone="neutral">{t('team.inactive')}</Badge>
            ) : member.isBookable ? (
              <Badge tone="mint">{t('team.bookableBadge')}</Badge>
            ) : (
              <Badge tone="peach">{t('team.notBookable')}</Badge>
            )}
            <Badge tone="lilac">
              {member.serviceIds === null ? t('team.allServicesShort') : t('team.servicesCount', { count: member.serviceIds.length })}
            </Badge>
          </div>
        </div>
        {onEdit ? (
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-ink-50 text-lg text-ink-700 group-hover:bg-ink-100">
            <EditIcon fontSize="inherit" />
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex gap-1" aria-hidden="true">
        {Array.from({ length: 7 }, (_, day) => {
          const works = (member.weekly[day] ?? []).length > 0;
          return (
            <span
              key={day}
              className={cx(
                'flex h-7 flex-1 items-center justify-center rounded-lg text-[0.6875rem] font-bold',
                works ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-500',
              )}
            >
              {weekdayName(day, locale, 'short').slice(0, 2)}
            </span>
          );
        })}
      </div>
      <p className="tabular mt-2 text-sm text-ink-700">{summary || t('team.noHours')}</p>
    </>
  );

  if (!onEdit) return <div className="h-full rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">{body}</div>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={t('team.editNamed', { name: member.name })}
      className="press lift group block h-full w-full rounded-2xl bg-white p-4 text-left ring-1 ring-inset ring-ink-100"
    >
      {body}
    </button>
  );
}

function TimeOffRow({ entry, member, now, onDelete }: { entry: TimeOff; member?: AdminStaff; now: number; onDelete?: () => void }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const start = zonedParts(entry.start, timeZone);
  const end = zonedParts(entry.end, timeZone);
  const wholeDays = start.time === '00:00' && end.time === '00:00';
  const lastDay = wholeDays ? addDays(end.date, -1) : end.date;
  const day = (date: string, long = false) => (long ? formatDayLong : formatDayShort)(dateToInstant(date), locale, 'UTC');
  const when = wholeDays
    ? start.date === lastDay
      ? `${day(start.date, true)} · ${t('timeOff.allDayShort')}`
      : `${day(start.date)} – ${day(lastDay)}`
    : start.date === end.date
      ? `${day(start.date, true)} · ${start.time}–${end.time}`
      : `${day(start.date)} ${start.time} – ${day(end.date)} ${end.time}`;
  const ongoing = new Date(entry.start).getTime() <= now;

  return (
    <li className="flex items-center gap-3 p-3">
      {member ? (
        <Avatar name={member.name} color={member.color} size="sm" />
      ) : (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-peach-50 text-lg text-peach-800">
          <StorefrontIcon fontSize="inherit" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {entry.staffId === null ? t('timeOff.studioClosed') : (member?.name ?? t('calendar.formerMaster'))}
          {ongoing ? <Badge tone="peach">{t('timeOff.now')}</Badge> : null}
        </p>
        <p className="tabular text-sm text-ink-700 first-letter:uppercase">{when}</p>
        {entry.reason ? <p className="text-sm text-ink-600">{entry.reason}</p> : null}
      </div>
      {onDelete ? <IconButton icon={DeleteIcon} label={t('timeOff.deleteNamed', { when })} onClick={onDelete} /> : null}
    </li>
  );
}
