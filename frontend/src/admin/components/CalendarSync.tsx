import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { GoogleMark } from '@/components/brand/GoogleMark';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Badge, Button, PasswordField, Sheet, Skeleton, TextField, toast } from '@/components/ui';
import { AppleIcon, CalendarIcon, ChevronRightIcon, ContentCopyIcon, EventIcon, SyncIcon, WarningIcon, type IconComponent } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { leaveFor } from '@/lib/leave';
import { currentPlatform } from '@/lib/platform';
import { isApiError } from '@/services/api/client';
import { adminApi, adminQueries, type CalendarSyncState } from '../api';
import { ConfirmSheet } from './ConfirmSheet';

type Target = 'apple' | 'google' | 'googleSteps' | 'outlook';
type Provider = 'google' | 'apple';

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

/** What Google's consent screen sent back (?calendar=…), as a toast. */
const GOOGLE_RETURNS: Record<string, { kind: 'success' | 'info' | 'error'; key: string }> = {
  google_connected: { kind: 'success', key: 'calendarSync.googleConnected' },
  google_cancelled: { kind: 'info', key: 'calendarSync.googleCancelled' },
  google_scope: { kind: 'error', key: 'calendarSync.googleScope' },
  google_failed: { kind: 'error', key: 'calendarSync.googleFailed' },
};

/**
 * My schedule → Calendar sync: the master's bookings in their own calendar. Instant: Google
 * Calendar or Apple's iCloud connected directly, written to the moment a booking changes. Or a
 * private subscribed feed any calendar app refreshes on its own (every few hours); the link can
 * be replaced (the old one stops working) or switched off.
 */
export function CalendarSync() {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const sync = useQuery(adminQueries.calendarSync());
  const feed = sync.data?.feed ?? null;
  const [confirm, setConfirm] = useState<'reset' | 'off' | null>(null);
  const [steps, setSteps] = useState(false);
  const [params, setParams] = useSearchParams();
  const announced = useRef<string | null>(null);
  const reveal = useRef(false);

  const done = (next: CalendarSyncState) => queryClient.setQueryData(adminQueries.calendarSync().queryKey, next);

  // Back from Google's consent screen: say how it went, once, and tidy the address.
  const googleReturn = params.get('calendar');
  useEffect(() => {
    if (!googleReturn || announced.current === googleReturn) return;
    announced.current = googleReturn;
    const { kind, key } = GOOGLE_RETURNS[googleReturn] ?? GOOGLE_RETURNS.google_failed!;
    toast[kind](t(key));
    void queryClient.invalidateQueries({ queryKey: adminQueries.calendarSync().queryKey });
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('calendar');
        return next;
      },
      { replace: true },
    );
    reveal.current = true;
  }, [googleReturn, queryClient, setParams, t]);

  // …and show this section: once the address is tidy (the page scrolls to the top on that change)
  // and the section has its content.
  useEffect(() => {
    if (!reveal.current || googleReturn || !sync.isSuccess) return;
    reveal.current = false;
    requestAnimationFrame(() => document.getElementById('calendar-sync')?.scrollIntoView?.({ block: 'start' }));
  }, [googleReturn, sync.isSuccess]);

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
    onSuccess: (next) => {
      done(next);
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
    <section id="calendar-sync" aria-labelledby="calendar-sync-title" className="scroll-mt-24">
      <SectionHeading id="calendar-sync-title" title={t('calendarSync.title')} />
      <p className="-mt-1 mb-4 text-sm text-ink-600">{t('calendarSync.text')}</p>
      {sync.isPending ? (
        <Skeleton rounded="xl" className="h-64" />
      ) : sync.isError ? (
        <Alert>{errorMessage(t, sync.error)}</Alert>
      ) : (
        <div className="flex flex-col gap-8">
          <InstantSync state={sync.data} onChange={done} />

          <div>
            <h3 className="text-h3 font-extrabold">{t('calendarSync.subscribeTitle')}</h3>
            {!feed ? (
              <div className="mt-3 flex flex-col items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5">
                <p className="text-[0.9375rem] text-ink-700">{t('calendarSync.offText')}</p>
                <Button size="md" variant="outline" icon={CalendarIcon} loading={turnOn.isPending} onClick={() => turnOn.mutate()}>
                  {t('calendarSync.turnOn')}
                </Button>
                {turnOn.isError ? <Alert>{errorMessage(t, turnOn.error)}</Alert> : null}
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <ul className="flex flex-col gap-2">
                  {targetsHere().map((target) =>
                    target === 'apple' ? (
                      <Option key={target} icon={CalendarIcon} label={t('calendarSync.apple')} hint={t('calendarSync.appleHint')} href={feed.webcal} />
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
                            <Button size="sm" variant="outline" icon={ContentCopyIcon} className="mt-3" onClick={() => void copy(feed.url)}>
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
                        href={feed.google}
                        newTab
                      />
                    ) : (
                      <Option key={target} icon={EventIcon} label={t('calendarSync.outlook')} hint={t('calendarSync.outlookHint')} href={feed.outlook} newTab />
                    ),
                  )}
                  <Option icon={ContentCopyIcon} label={t('calendarSync.copy')} hint={t('calendarSync.copyHint')} onClick={() => void copy(feed.url)} />
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

/**
 * Instant sync: Google Calendar and Apple Calendar (iCloud), each connected or not. Google
 * connects on Google's own consent screen (the app leaves for it and comes back); iCloud takes
 * the Apple ID and an app-specific password, in a sheet.
 */
function InstantSync({ state, onChange }: { state: CalendarSyncState; onChange: (next: CalendarSyncState) => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const [appleOpen, setAppleOpen] = useState(false);
  const [leaving, setLeaving] = useState<Provider | null>(null);

  const connectGoogle = useMutation({
    mutationFn: adminApi.connectGoogleCalendar,
    // Google's consent screen, in this tab: Google sends the master back to My schedule.
    onSuccess: (url) => leaveFor(url),
  });
  const syncNow = useMutation({
    mutationFn: adminApi.syncCalendarsNow,
    onSuccess: (next) => {
      onChange(next);
      toast.success(t('calendarSync.syncStarted'));
    },
  });
  const disconnect = useMutation({
    mutationFn: (provider: Provider) => (provider === 'google' ? adminApi.disconnectGoogleCalendar() : adminApi.disconnectAppleCalendar()),
    onSuccess: (next, provider) => {
      onChange(next);
      toast.success(t(provider === 'google' ? 'calendarSync.googleDisconnected' : 'calendarSync.appleDisconnected'));
      setLeaving(null);
    },
  });
  const failed = connectGoogle.error ?? syncNow.error;

  const googleLabel = t('calendarSync.googleCalendar');
  const appleLabel = t('calendarSync.appleCalendar');

  return (
    <div>
      <h3 className="text-h3 font-extrabold">{t('calendarSync.instantTitle')}</h3>
      <p className="mb-3 mt-1 text-sm text-ink-600">{t('calendarSync.instantText')}</p>
      <ul className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
        <Connection
          mark={<GoogleMark className="size-5" />}
          label={googleLabel}
          state={state.google}
          account={state.google.email}
          hint={state.google.available ? t('calendarSync.googleInstantHint') : t('calendarSync.googleUnavailable')}
          reconnectHint={t('calendarSync.googleReconnectHint')}
          disabled={!state.google.available}
          connecting={connectGoogle.isPending}
          onConnect={() => connectGoogle.mutate()}
          syncing={syncNow.isPending}
          onSync={() => syncNow.mutate()}
          onDisconnect={() => setLeaving('google')}
        />
        <Connection
          mark={<AppleIcon fontSize="inherit" />}
          label={appleLabel}
          state={state.apple}
          account={state.apple.appleId}
          hint={t('calendarSync.appleInstantHint')}
          reconnectHint={t('calendarSync.appleReconnectHint')}
          onConnect={() => setAppleOpen(true)}
          syncing={syncNow.isPending}
          onSync={() => syncNow.mutate()}
          onDisconnect={() => setLeaving('apple')}
        />
      </ul>
      {failed ? <Alert className="mt-3">{errorMessage(t, failed)}</Alert> : null}

      <AppleConnectSheet
        open={appleOpen}
        onClose={() => setAppleOpen(false)}
        onConnected={(next) => {
          onChange(next);
          setAppleOpen(false);
          toast.success(t('calendarSync.appleConnected'));
        }}
      />
      <ConfirmSheet
        open={leaving !== null}
        onClose={() => {
          setLeaving(null);
          disconnect.reset();
        }}
        title={t('calendarSync.disconnectTitle', { name: leaving === 'google' ? googleLabel : appleLabel })}
        description={leaving === 'google' ? t('calendarSync.disconnectGoogleText') : t('calendarSync.disconnectAppleText')}
        confirmLabel={t('calendarSync.disconnect')}
        loading={disconnect.isPending}
        error={disconnect.error}
        onConfirm={() => leaving && disconnect.mutate(leaving)}
      />
    </div>
  );
}

/** One calendar in "Instant sync": what it is, whether it's connected (and as whom), and what to do. */
function Connection({
  mark,
  label,
  state,
  account,
  hint,
  reconnectHint,
  disabled,
  connecting,
  onConnect,
  syncing,
  onSync,
  onDisconnect,
}: {
  mark: ReactNode;
  label: string;
  state: { connected: boolean; needsReconnect: boolean };
  account: string | null;
  hint: string;
  reconnectHint: string;
  disabled?: boolean;
  connecting?: boolean;
  onConnect: () => void;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { connected, needsReconnect } = state;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-ink-900 ring-1 ring-inset ring-ink-100">
          {mark}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{label}</span>
            {connected ? (
              <Badge tone={needsReconnect ? 'peach' : 'mint'}>{needsReconnect ? t('calendarSync.needsReconnect') : t('calendarSync.connected')}</Badge>
            ) : null}
          </p>
          {connected && account ? (
            // An email breaks anywhere rather than overflow; sentences wrap between words.
            <p className="text-sm text-ink-600 [overflow-wrap:anywhere]">{account}</p>
          ) : (
            <p className="text-sm text-ink-600">{connected ? t('calendarSync.connectedHint') : hint}</p>
          )}
          {needsReconnect ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-peach-800">
              <WarningIcon fontSize="inherit" className="mt-[0.15rem] shrink-0 text-base" />
              <span>{reconnectHint}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[3.25rem] sm:shrink-0 sm:justify-end sm:pl-0">
        {!connected || needsReconnect ? (
          <Button
            size="sm"
            variant={needsReconnect ? 'primary' : 'outline'}
            disabled={disabled}
            loading={connecting}
            onClick={onConnect}
            aria-label={t(needsReconnect ? 'calendarSync.reconnectNamed' : 'calendarSync.connectNamed', { name: label })}
          >
            {needsReconnect ? t('calendarSync.reconnect') : t('calendarSync.connect')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" icon={SyncIcon} loading={syncing} onClick={onSync} aria-label={t('calendarSync.syncNamed', { name: label })}>
            {t('calendarSync.syncNow')}
          </Button>
        )}
        {connected ? (
          <Button size="sm" variant="ghost" onClick={onDisconnect} aria-label={t('calendarSync.disconnectNamed', { name: label })}>
            {t('calendarSync.disconnect')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Apple Calendar: the Apple ID and an app-specific password (iCloud takes no other password
 * from an app), with the three steps to make one. Checked with Apple before the sheet closes.
 */
function AppleConnectSheet({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: (next: CalendarSyncState) => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const connect = useMutation({
    mutationFn: () => adminApi.connectAppleCalendar({ appleId: appleId.trim(), password: password.trim() }),
    onSuccess: (next) => {
      setPassword('');
      setTouched(false);
      onConnected(next);
    },
  });
  const close = () => {
    setPassword('');
    setTouched(false);
    connect.reset();
    onClose();
  };

  const server = fieldErrors(t, connect.error);
  const refused = isApiError(connect.error, 'CALENDAR_AUTH');
  const required = t('common:validation.required');
  const errors = {
    appleId: touched && !appleId.trim() ? required : server.appleId,
    password: touched && !password.trim() ? required : refused ? t('calendarSync.appleRefused') : server.password,
  };
  const other =
    connect.isError && !refused && Object.keys(server).length === 0
      ? isApiError(connect.error, 'CALENDAR_UNREACHABLE')
        ? t('calendarSync.appleUnreachable')
        : errorMessage(t, connect.error)
      : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!appleId.trim() || !password.trim()) return;
    connect.mutate();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('calendarSync.appleTitle')}
      description={t('calendarSync.appleText')}
      footer={
        <Button type="submit" form="apple-calendar-form" size="md" fullWidth loading={connect.isPending}>
          {t('calendarSync.appleSubmit')}
        </Button>
      }
    >
      <form id="apple-calendar-form" className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
        <div className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">{t('calendarSync.appleHowTitle')}</p>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
            <li>
              <Trans
                t={t}
                i18nKey="calendarSync.appleStep1"
                components={{
                  // Not "link": Trans reads <link> as the empty HTML element.
                  site: <a href="https://account.apple.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-900 underline underline-offset-4" />,
                }}
              />
            </li>
            <li>{t('calendarSync.appleStep2')}</li>
            <li>{t('calendarSync.appleStep3')}</li>
          </ol>
        </div>
        <TextField
          label={t('calendarSync.appleId')}
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          error={errors.appleId}
        />
        <PasswordField
          label={t('calendarSync.applePassword')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={t('calendarSync.applePasswordHint')}
        />
        {other ? <Alert>{other}</Alert> : null}
      </form>
    </Sheet>
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
