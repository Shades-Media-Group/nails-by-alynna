import { useTranslation } from 'react-i18next';
import { Avatar, Badge, IconButton } from '@/components/ui';
import { DeleteIcon, StorefrontIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { addDays, dateToInstant, formatDayLong, formatDayShort } from '@/lib/format';
import type { AdminStaff, TimeOff } from '../api';
import { zonedParts } from './time';

/** One block of time off: who (a master or the whole studio), when, why. */
export function TimeOffRow({ entry, member, now, onDelete }: { entry: TimeOff; member?: AdminStaff; now: number; onDelete?: () => void }) {
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
