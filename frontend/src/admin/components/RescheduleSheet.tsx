import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Sheet } from '@/components/ui';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { isApiError } from '@/services/api/client';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatTime } from '@/lib/format';
import type { StaffAppointment } from '@/types/api';
import { adminApi, adminQueries } from '../api';
import { MasterPicker } from './MasterPicker';
import { SlotPicker, type TimeChoice } from './SlotPicker';
import { eligibleMasters } from './utils';

/**
 * Move a booking: same services, a new time from the free ones (or typed by hand), and
 * optionally another master. Mount it only while shown.
 */
export function RescheduleSheet({
  appointment,
  onClose,
  onDone,
}: {
  appointment: StaffAppointment;
  onClose: () => void;
  onDone: (updated: StaffAppointment) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const serviceIds = appointment.services.map((s) => s.id);
  const staff = useQuery(adminQueries.staff());
  const masters = eligibleMasters(staff.data, serviceIds);
  const current = appointment.staff?.id ?? null;
  // Until someone picks, the current master (once the team has loaded), else any master.
  const [picked, setPicked] = useState<{ staffId: string | null } | null>(null);
  const staffId = picked ? picked.staffId : current && masters.some((m) => m.id === current) ? current : null;
  const pickerKey = staffId ?? 'any';
  // A time belongs to the master it was picked for.
  const [chosen, setChosen] = useState<{ key: string; value: TimeChoice } | null>(null);
  const choice = chosen?.key === pickerKey ? chosen.value : null;

  const save = useMutation({
    mutationFn: (time: TimeChoice) => {
      // A free time names the masters free then: keep the current one when possible.
      const resolved = staffId ?? (time.custom ? null : current && time.staffIds.includes(current) ? current : (time.staffIds[0] ?? null));
      return adminApi.rescheduleAppointment(appointment.id, { start: time.start, staffId: resolved, force: time.force });
    },
    onSuccess: onDone,
  });

  const end = choice ? new Date(new Date(choice.start).getTime() + appointment.durationMin * 60_000) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={t('appointment.rescheduleTitle')}
      description={t('appointment.rescheduleText', { date: formatDateTime(appointment.start, locale, timeZone) })}
      footer={
        <div className="flex flex-col gap-3">
          {choice && end ? (
            <p className="text-sm text-ink-700" aria-live="polite">
              <span className="font-semibold first-letter:uppercase">{formatDateTime(choice.start, locale, timeZone)}</span>
              {' – '}
              <span className="tabular">{formatTime(end, locale, timeZone)}</span>
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft" size="md" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="md" disabled={!choice} loading={save.isPending} onClick={() => choice && save.mutate(choice)}>
              {t('appointment.move')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6 py-2">
        {masters.length > 1 ? (
          <section aria-labelledby="reschedule-master" className="flex flex-col gap-2">
            <h3 id="reschedule-master" className="text-sm font-semibold text-ink-700">
              {t('booking.master')}
            </h3>
            <MasterPicker
              masters={masters}
              value={staffId}
              onChange={(next) => setPicked({ staffId: next })}
              anyLabel={t('booking.anyMaster')}
              anyText={t('booking.anyMasterText')}
            />
          </section>
        ) : null}
        <section aria-labelledby="reschedule-time" className="flex flex-col gap-2">
          <h3 id="reschedule-time" className="text-sm font-semibold text-ink-700">
            {t('booking.time')}
          </h3>
          <SlotPicker
            key={pickerKey}
            serviceIds={serviceIds}
            staffId={staffId}
            value={choice}
            onChange={(value) => setChosen(value ? { key: pickerKey, value } : null)}
            exclude={appointment.id}
          />
        </section>
        {save.isError ? (
          <Alert>
            {errorMessage(t, save.error)}
            {isApiError(save.error, 'SLOT_TAKEN') ? <span className="mt-1 block">{t('booking.overlapHint')}</span> : null}
          </Alert>
        ) : null}
      </div>
    </Sheet>
  );
}
