import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Select, Sheet, Switch, TextField, toast } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { adminApi, type AdminStaff, type TimeOffInput } from '../api';
import { isDate, isTime, timeToMinutes } from './time';

const STUDIO = 'studio';

/**
 * Block time: a master's day off, holiday or appointment elsewhere, or (owner only) the whole
 * studio closed. Whole days by default; a start and end time for part of a day.
 */
export function TimeOffEditor({
  masters,
  canCloseStudio,
  today,
  onClose,
}: {
  masters: AdminStaff[];
  canCloseStudio: boolean;
  today: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [who, setWho] = useState<string>(masters[0]?.id ?? STUDIO);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const issues: Record<string, string> = {};
  if (!isDate(from)) issues.from = 'required';
  if (!isDate(to)) issues.to = 'required';
  else if (isDate(from) && to < from) issues.to = 'end_before_start';
  if (!allDay) {
    if (!isTime(startTime)) issues.startTime = 'required';
    if (!isTime(endTime)) issues.endTime = 'required';
    else if (from === to && isTime(startTime) && timeToMinutes(endTime) <= timeToMinutes(startTime)) issues.endTime = 'end_before_start';
  }

  const save = useMutation({
    mutationFn: () => {
      const input: TimeOffInput = {
        staffId: who === STUDIO ? null : who,
        from,
        to,
        reason: reason.trim(),
        ...(allDay ? {} : { startTime, endTime }),
      };
      return adminApi.createTimeOff(input);
    },
    onSuccess: () => {
      for (const queryKey of [['admin', 'time-off'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(t('timeOff.added'));
      onClose();
    },
  });
  const server = fieldErrors(t, save.error);
  const message = (field: string) =>
    (touched && issues[field] ? t(`timeOff.issues.${issues[field]}`, { defaultValue: t(`common:validation.${issues[field]}`) }) : undefined) ?? server[field];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(issues).length > 0) return;
    save.mutate();
  };

  const options = [
    ...masters.map((m) => ({ value: m.id, label: m.name })),
    ...(canCloseStudio ? [{ value: STUDIO, label: t('timeOff.wholeStudio') }] : []),
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('timeOff.new')}
      description={t('timeOff.newHint')}
      footer={
        <Button type="submit" form="time-off-form" size="md" loading={save.isPending} className="min-w-32">
          {t('timeOff.save')}
        </Button>
      }
    >
      <form id="time-off-form" className="flex flex-col gap-5 py-2" onSubmit={submit} noValidate>
        <Select label={t('timeOff.who')} value={who} onChange={(e) => setWho(e.target.value)} options={options} />
        {who === STUDIO ? <Alert tone="warning">{t('timeOff.studioWarning')}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('timeOff.from')}
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (isDate(e.target.value) && (!isDate(to) || to < e.target.value)) setTo(e.target.value);
            }}
            error={message('from')}
          />
          <TextField label={t('timeOff.to')} type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} error={message('to')} />
        </div>
        <Switch checked={allDay} onChange={setAllDay} label={t('timeOff.allDay')} description={t('timeOff.allDayHint')} />
        {!allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('timeOff.startTime')}
              type="time"
              step={300}
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              error={message('startTime')}
              hint={from !== to ? t('timeOff.startTimeHint') : undefined}
            />
            <TextField
              label={t('timeOff.endTime')}
              type="time"
              step={300}
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              error={message('endTime')}
              hint={from !== to ? t('timeOff.endTimeHint') : undefined}
            />
          </div>
        ) : null}
        <TextField
          label={`${t('timeOff.reason')} (${t('common.optional')})`}
          maxLength={200}
          placeholder={t('timeOff.reasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={server.reason}
        />
        {save.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}
