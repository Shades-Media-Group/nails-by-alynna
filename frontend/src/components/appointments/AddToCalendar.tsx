import { useTranslation } from 'react-i18next';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Sheet } from '@/components/ui';
import { CalendarAddIcon, ChevronRightIcon, EventIcon, type IconComponent } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { calendarEventFor } from '@/lib/appointment';
import { downloadIcs } from '@/lib/ics';
import { isStandalone } from '@/lib/platform';
import type { Appointment } from '@/types/api';

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * "Add to calendar": the phone's own calendar (the server's .ics link, which iPhone and Mac open
 * in their "Add to Calendar" sheet), Google Calendar, or any other app. Inside the installed
 * iPhone app the file opens in a separate view, so the app itself never gets stuck on it.
 */
export function AddToCalendarSheet({ appointment, open, onClose }: { appointment: Appointment; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['booking', 'common']);
  const { locale } = useLocale();
  const pick = useI18nText();
  const { data: config } = useStudio();
  const address = [config?.studio.address, config?.studio.city].filter(Boolean).join(', ');
  const event = calendarEventFor(appointment, { t, locale, pick, address });

  const openFile = () => {
    onClose();
    const url = appointment.calendarUrl;
    if (!url) {
      downloadIcs(event, `nails-by-alynna-${appointment.code}.ics`);
      return;
    }
    if (isStandalone()) window.open(url, '_blank', 'noopener');
    else window.location.assign(url);
  };
  const openGoogle = () => {
    onClose();
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${stamp(event.start)}/${stamp(event.end)}`,
      details: event.description,
      location: event.location,
    });
    window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('calendar.sheetTitle')} description={t('calendar.sheetText')}>
      <ul className="flex flex-col gap-2 py-2">
        <Option icon={CalendarAddIcon} label={t('calendar.apple')} onClick={openFile} />
        <Option mark={<GoogleMark className="size-5" />} label={t('calendar.google')} onClick={openGoogle} />
        <Option icon={EventIcon} label={t('calendar.other')} onClick={openFile} />
      </ul>
    </Sheet>
  );
}

function Option({ icon: Icon, mark, label, onClick }: { icon?: IconComponent; mark?: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="press flex w-full items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3.5 text-left font-semibold hover:bg-ink-100"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-ink-800">
          {mark ?? (Icon ? <Icon fontSize="inherit" /> : null)}
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRightIcon fontSize="inherit" className="shrink-0 text-xl text-ink-400" />
      </button>
    </li>
  );
}
