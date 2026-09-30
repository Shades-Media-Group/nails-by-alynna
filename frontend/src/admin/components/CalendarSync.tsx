import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Button, Skeleton, toast } from '@/components/ui';
import { CalendarIcon, ChevronRightIcon, ContentCopyIcon, EventIcon, type IconComponent } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { currentPlatform } from '@/lib/platform';
import { adminApi, adminQueries, type CalendarFeed } from '../api';
import { ConfirmSheet } from './ConfirmSheet';

type Target = 'apple' | 'google' | 'googleSteps' | 'outlook';

/**
 * The calendars to offer on this device, its own first. Google lets you subscribe by URL only on
 * a computer (its phone apps can't, and a link opened on Android lands in the app and fails), so
 * phones get the steps instead; the subscription then shows in the Google Calendar app too.
 * Outlook's page is for computers as well.
 */
function targetsHere(): Target[] {
  const { os } = currentPlatform();
  if (os === 'android') return ['googleSteps'];
  if (os === 'ios' || os === 'ipados') return ['apple', 'googleSteps'];
  return ['google', 'apple', 'outlook'];
}

/**
 * My schedule → Calendar sync: the master's bookings in Apple Calendar, Google Calendar or
 * Outlook, kept up to date by the calendar app itself (a private subscribed feed). The link can
 * be replaced (the old one stops working) or switched off.
 */
export function CalendarSync() {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const feed = useQuery(adminQueries.calendarFeed());
  const [confirm, setConfirm] = useState<'reset' | 'off' | null>(null);
  const [steps, setSteps] = useState(false);

  const done = (next: CalendarFeed | null) => queryClient.setQueryData(adminQueries.calendarFeed().queryKey, next);
  const turnOn = useMutation({
    mutationFn: adminApi.createCalendarFeed,
    onSuccess: (next) => {
      done(next);
      toast.success(confirm === 'reset' ? t('calendarSync.resetDone') : t('calendarSync.onDone'));
      setConfirm(null);
    },
  });
  const turnOff = useMutation({
    mutationFn: adminApi.deleteCalendarFeed,
    onSuccess: () => {
      done(null);
      toast.success(t('calendarSync.offDone'));
      setConfirm(null);
    },
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('calendarSync.copied'));
    } catch {
      toast.error(t('calendarSync.copyFailed'));
    }
  };

  return (
    <section aria-labelledby="calendar-sync-title">
      <SectionHeading id="calendar-sync-title" title={t('calendarSync.title')} />
      <p className="-mt-1 mb-3 text-sm text-ink-600">{t('calendarSync.text')}</p>
      {feed.isPending ? (
        <Skeleton rounded="xl" className="h-40" />
      ) : feed.isError ? (
        <Alert>{errorMessage(t, feed.error)}</Alert>
      ) : !feed.data ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
          <p className="text-[0.9375rem] text-ink-700">{t('calendarSync.offText')}</p>
          <Button size="md" icon={CalendarIcon} loading={turnOn.isPending} onClick={() => turnOn.mutate()}>
            {t('calendarSync.turnOn')}
          </Button>
          {turnOn.isError ? <Alert>{errorMessage(t, turnOn.error)}</Alert> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {targetsHere().map((target) =>
              target === 'apple' ? (
                <Option key={target} icon={CalendarIcon} label={t('calendarSync.apple')} hint={t('calendarSync.appleHint')} href={feed.data!.webcal} />
              ) : target === 'googleSteps' ? (
                <li key={target} className="flex flex-col">
                  <OptionBody
                    mark={<GoogleMark className="size-5" />}
                    label={t('calendarSync.google')}
                    hint={t('calendarSync.googleStepsHint')}
                    expanded={steps}
                    onClick={() => setSteps((open) => !open)}
                  />
                  {steps ? (
                    <div className="mx-2 -mt-2 rounded-b-2xl bg-ink-50 px-4 pb-4 pt-5 text-sm text-ink-700">
                      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                        <li>{t('calendarSync.googleStep1')}</li>
                        <li>{t('calendarSync.googleStep2')}</li>
                        <li>{t('calendarSync.googleStep3')}</li>
                      </ol>
                      <p className="mt-2">{t('calendarSync.googleStepsAfter')}</p>
                      <Button size="sm" variant="outline" icon={ContentCopyIcon} className="mt-3" onClick={() => void copy(feed.data!.url)}>
                        {t('calendarSync.copy')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ) : target === 'google' ? (
                <Option
                  key={target}
                  mark={<GoogleMark className="size-5" />}
                  label={t('calendarSync.google')}
                  hint={t('calendarSync.googleHint')}
                  href={feed.data!.google}
                  newTab
                />
              ) : (
                <Option key={target} icon={EventIcon} label={t('calendarSync.outlook')} hint={t('calendarSync.outlookHint')} href={feed.data!.outlook} newTab />
              ),
            )}
            <Option icon={ContentCopyIcon} label={t('calendarSync.copy')} hint={t('calendarSync.copyHint')} onClick={() => void copy(feed.data!.url)} />
          </ul>
          <p className="rounded-xl bg-peach-50 p-3 text-sm text-peach-800">{t('calendarSync.private')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirm('reset')}>
              {t('calendarSync.reset')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('off')}>
              {t('calendarSync.turnOff')}
            </Button>
          </div>
        </div>
      )}
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'reset' ? t('calendarSync.resetTitle') : t('calendarSync.offTitle')}
        description={confirm === 'reset' ? t('calendarSync.resetText') : t('calendarSync.offText2')}
        confirmLabel={confirm === 'reset' ? t('calendarSync.reset') : t('calendarSync.turnOff')}
        loading={turnOn.isPending || turnOff.isPending}
        error={turnOn.error ?? turnOff.error}
        onConfirm={() => (confirm === 'reset' ? turnOn.mutate() : turnOff.mutate())}
      />
    </section>
  );
}

interface OptionProps {
  icon?: IconComponent;
  mark?: ReactNode;
  label: string;
  hint: string;
  href?: string;
  newTab?: boolean;
  onClick?: () => void;
  /** A button that shows more below it (true/false), rather than going somewhere. */
  expanded?: boolean;
}

const optionClass = 'press relative flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-inset ring-ink-100 hover:bg-ink-50';

function OptionBody({ icon: Icon, mark, label, hint, href, newTab, onClick, expanded }: OptionProps) {
  const body = (
    <>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-ink-800 ring-1 ring-inset ring-ink-100">
        {mark ?? (Icon ? <Icon fontSize="inherit" /> : null)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-sm text-ink-600">{hint}</span>
      </span>
      <ChevronRightIcon
        fontSize="inherit"
        className={cx('shrink-0 text-xl text-ink-400 transition-transform duration-200', expanded && 'rotate-90')}
      />
    </>
  );
  return href ? (
    <a href={href} className={optionClass} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={optionClass} aria-expanded={expanded}>
      {body}
    </button>
  );
}

function Option(props: OptionProps) {
  return (
    <li>
      <OptionBody {...props} />
    </li>
  );
}
