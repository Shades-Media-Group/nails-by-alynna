import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Sheet } from '@/components/ui';
import { CalendarAddIcon, ChevronRightIcon, EventIcon, type IconComponent } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { calendarEventFor } from '@/lib/appointment';
import { calendarChoices, fileAction, googleAppIntent, googleEventUrl, outlookEventUrl, type CalendarChoice } from '@/lib/calendarLinks';
import { downloadFile, downloadIcs } from '@/lib/ics';
import { currentPlatform, isStandalone } from '@/lib/platform';
import type { Appointment } from '@/types/api';

/**
 * "Add to calendar" for a visit: `open` from the button's tap. With a single choice (iPhone,
 * iPad) it goes straight to the phone's calendar; otherwise it opens a sheet of choices.
 */
function useAddToCalendar(appointment: Appointment): { open: () => void; sheet: ReactNode } {
  const { t } = useTranslation(['booking', 'common']);
  const { locale } = useLocale();
  const pick = useI18nText();
  const { data: config, timeZone } = useStudio();
  const [sheetOpen, setSheetOpen] = useState(false);
  const address = [config?.studio.address, config?.studio.city].filter(Boolean).join(', ');
  const choices = calendarChoices();

  const run = (choice: CalendarChoice) => {
    setSheetOpen(false);
    const event = calendarEventFor(appointment, { t, locale, pick, address });
    if (choice === 'googleApp') {
      window.location.assign(googleAppIntent(event, timeZone));
      return;
    }
    if (choice === 'googleWeb' || choice === 'outlook') {
      window.open(choice === 'outlook' ? outlookEventUrl(event) : googleEventUrl(event, timeZone), '_blank', 'noopener,noreferrer');
      return;
    }
    // The server's .ics link (lib/calendarLinks.ts fileAction says how, per device).
    const filename = `nails-by-alynna-${appointment.code}.ics`;
    const url = appointment.calendarUrl;
    if (!url) {
      downloadIcs(event, filename);
      return;
    }
    const action = fileAction(new URL(url, window.location.origin).href, {
      os: currentPlatform().os,
      standalone: isStandalone(),
      ua: navigator.userAgent,
    });
    if (action.kind === 'open') window.open(action.href, '_blank', 'noopener');
    else if (action.kind === 'download') downloadFile(action.href, filename);
    else window.location.assign(action.href);
  };

  const open = () => {
    if (choices.length === 1) run(choices[0]!);
    else setSheetOpen(true);
  };

  const sheet = (
    <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('calendar.sheetTitle')} description={t('calendar.sheetText')}>
      <ul className="flex flex-col gap-2 py-2">
        {choices.map((choice) => (
          <Option
            key={choice}
            icon={choice === 'outlook' ? EventIcon : CalendarAddIcon}
            mark={choice === 'googleApp' || choice === 'googleWeb' ? <GoogleMark className="size-5" /> : undefined}
            label={t(`calendar.choices.${choice}`)}
            hint={t(`calendar.hints.${choice}`)}
            onClick={() => run(choice)}
          />
        ))}
      </ul>
    </Sheet>
  );

  return { open, sheet };
}

/** "Add to calendar" for a visit: `children` draws the button, which calls `open` on tap. */
export function AddToCalendar({ appointment, children }: { appointment: Appointment; children: (open: () => void) => ReactNode }) {
  const { open, sheet } = useAddToCalendar(appointment);
  return (
    <>
      {children(open)}
      {sheet}
    </>
  );
}

function Option({ icon: Icon, mark, label, hint, onClick }: { icon?: IconComponent; mark?: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="press flex w-full items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3.5 text-left hover:bg-ink-100"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-ink-800">
          {mark ?? (Icon ? <Icon fontSize="inherit" /> : null)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          <span className="block text-sm text-ink-600">{hint}</span>
        </span>
        <ChevronRightIcon fontSize="inherit" className="shrink-0 text-xl text-ink-400" />
      </button>
    </li>
  );
}
