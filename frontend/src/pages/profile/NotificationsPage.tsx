import NotificationsActiveIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOffRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink, Chip, Skeleton, Switch, toast } from '@/components/ui';
import { CheckIcon, RefreshIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { currentPlatform } from '@/lib/platform';
import {
  disablePush,
  enablePush,
  isAppleDevice,
  readPushState,
  resyncPush,
  type PushState,
} from '@/lib/push';
import {
  notificationsApi,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type NotificationSettings,
  type ReminderLead,
} from '@/services/api/endpoints';
import { queries } from '@/services/queries';

const KEY = ['notifications'] as const;
const LEADS: ReminderLead[] = [60, 120, 1440];
/** The installed app's name on the Home Screen and in iOS Settings (index.html, manifest short_name). */
const HOME_SCREEN_NAME = 'Nails Alynna';
/** The shared Switch is 28 px tall: widen its tap area to 44 px without changing how it looks. */
const SWITCH_TAP_AREA = '[&_[role=switch]]:before:absolute [&_[role=switch]]:before:-inset-2';
type DeviceState = PushState | 'loading' | 'unavailable';
type Category = 'reminders' | 'bookingUpdates' | 'staffBookings' | 'loyalty' | 'marketing';

function mergePrefs(prefs: NotificationPrefs, patch: NotificationPrefsPatch): NotificationPrefs {
  return {
    reminders: { ...prefs.reminders, ...patch.reminders },
    bookingUpdates: { ...prefs.bookingUpdates, ...patch.bookingUpdates },
    staffBookings: { ...prefs.staffBookings, ...patch.staffBookings },
    loyalty: { ...prefs.loyalty, ...patch.loyalty },
    marketing: { ...prefs.marketing, ...patch.marketing },
  };
}

/** Profile → Notifications: this device's switch first, then what to hear about and how. */
export default function NotificationsPage() {
  const { t } = useTranslation(['account', 'common']);
  const { lp } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: KEY, queryFn: notificationsApi.get });
  const config = useQuery(queries.config());
  const [device, setDevice] = useState<DeviceState>('loading');
  const userId = user?.id ?? '';
  const demo = user?.isDemo === true;
  const pushConfigured = settings.data?.push.available;

  useEffect(() => {
    if (!userId || pushConfigured === undefined) return;
    let alive = true;
    const read = () => {
      const next = pushConfigured
        ? readPushState(userId)
        : Promise.resolve<DeviceState>('unavailable');
      void next.then((state) => {
        if (!alive) return;
        setDevice(state);
        // Make sure this device is attached to the current sign-in.
        if (state === 'on') void resyncPush(userId);
      });
    };
    read();
    // Back from the phone's Settings (e.g. after allowing notifications): look again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, pushConfigured]);

  const update = useMutation({
    mutationFn: notificationsApi.update,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData<NotificationSettings>(KEY);
      if (previous)
        queryClient.setQueryData<NotificationSettings>(KEY, {
          ...previous,
          prefs: mergePrefs(previous.prefs, patch),
        });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
      toast.error(errorMessage(t, error));
    },
    onSuccess: (prefs) => {
      queryClient.setQueryData<NotificationSettings>(KEY, (old) => (old ? { ...old, prefs } : old));
      toast.success(t('notifications.saved'), { id: 'notification-prefs' });
    },
  });

  // Loyalty messages only mean something while the studio runs the stamp card.
  const loyalty = (config.data as { loyalty?: { enabled?: boolean } } | undefined)?.loyalty;
  const loyaltyOn = Boolean(config.data) && loyalty?.enabled !== false;

  return (
    <div className="pb-10">
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        back
        backTo={lp('/profile')}
      />
      <div className="gutter-x mt-6 flex flex-col gap-7 lg:max-w-2xl lg:px-0">
        {settings.isPending ? (
          [0, 1, 2].map((i) => (
            <Skeleton key={i} rounded="xl" className={i === 0 ? 'h-28' : 'h-40'} />
          ))
        ) : settings.isError ? (
          <div className="flex flex-col items-start gap-3">
            <Alert>{errorMessage(t, settings.error)}</Alert>
            <Button
              variant="outline"
              size="md"
              icon={RefreshIcon}
              onClick={() => void settings.refetch()}
            >
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : (
          <>
            {demo ? (
              <Alert tone="info">{t('notifications.device.demo')}</Alert>
            ) : (
              <DeviceCard state={device} userId={userId} onState={setDevice} />
            )}
            <Preferences
              settings={settings.data}
              device={device}
              loyaltyOn={loyaltyOn}
              staff={user?.role === 'admin' || user?.role === 'administrator'}
              readOnly={demo}
              onChange={(patch) => update.mutate(patch)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── This device ────────────────────────────────────────────────────────────────

function DeviceCard({
  state,
  userId,
  onState,
}: {
  state: DeviceState;
  userId: string;
  onState: (state: DeviceState) => void;
}) {
  const { t } = useTranslation(['account', 'common']);
  const { lp } = useLocale();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const platform = currentPlatform();
  const title =
    platform.os === 'ios' || platform.os === 'android'
      ? t('notifications.device.titlePhone')
      : t('notifications.device.titleDevice');
  const test = useMutation({
    mutationFn: notificationsApi.test,
    onSuccess: (result) =>
      result.sent > 0
        ? toast.success(t('notifications.device.testSent'))
        : toast.error(t('notifications.device.testNone')),
    onError: (error) => toast.error(errorMessage(t, error)),
  });

  // Straight from the tap: Safari shows the permission prompt only for a user gesture.
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const result = await enablePush(userId);
        onState(result);
        if (result === 'on') toast.success(t('notifications.device.enabled'));
        else if (result === 'off') toast(t('notifications.device.dismissed'));
      } else {
        await disablePush();
        onState('off');
        toast.success(t('notifications.device.disabled'));
      }
    } catch (error) {
      toast.error(errorMessage(t, error));
      onState(await readPushState(userId).catch(() => 'off' as const));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: KEY });
    }
  };

  if (state === 'loading') return <Skeleton rounded="xl" className="h-28" />;

  const on = state === 'on';
  const canToggle = state === 'on' || state === 'off';
  const checkAgain = (
    <Button
      variant="outline"
      size="md"
      icon={RefreshIcon}
      onClick={() => void readPushState(userId).then(onState)}
    >
      {t('notifications.device.checkAgain')}
    </Button>
  );

  let heading = title;
  let message: ReactNode = null;
  let action: ReactNode = null;
  if (state === 'needs-install') {
    heading = t('notifications.device.installTitle');
    message = t('notifications.device.install');
    action = (
      <ButtonLink to={lp('/app')} size="md">
        {t('notifications.device.installAction')}
      </ButtonLink>
    );
  } else if (state === 'denied') {
    heading = t('notifications.device.deniedTitle');
    message = isAppleDevice()
      ? t('notifications.device.deniedIos', { app: HOME_SCREEN_NAME })
      : platform.os === 'android'
        ? t('notifications.device.deniedAndroid')
        : t('notifications.device.deniedDesktop');
    action = checkAgain;
  } else if (state === 'unsupported') {
    message = isAppleDevice()
      ? t('notifications.device.unsupportedIos')
      : t('notifications.device.unsupported');
  } else if (state === 'no-service-worker') {
    message = t('notifications.device.preview');
  } else if (state === 'not-ready') {
    message = t('notifications.device.notReady');
    action = checkAgain;
  } else if (state === 'unavailable') {
    message = t('notifications.device.unavailable');
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100 sm:p-5"
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cx(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-[1.35rem] transition-colors duration-200',
            on ? 'bg-ink-900 text-white' : 'bg-blush-100 text-ink-800',
          )}
          aria-hidden="true"
        >
          {on ? (
            <NotificationsActiveIcon fontSize="inherit" />
          ) : (
            <NotificationsOffIcon fontSize="inherit" />
          )}
        </span>
        <div className={cx('min-w-0 flex-1', SWITCH_TAP_AREA)}>
          {canToggle ? (
            <Switch
              label={<span id={titleId}>{title}</span>}
              description={on ? t('notifications.device.on') : t('notifications.device.off')}
              checked={on}
              disabled={busy}
              onChange={(next) => void toggle(next)}
            />
          ) : (
            <>
              <h2 id={titleId} className="text-[0.9375rem] font-semibold text-ink-900">
                {heading}
              </h2>
              <p className="mt-0.5 text-sm text-ink-600">{message}</p>
            </>
          )}
          {on ? (
            <Button
              variant="outline"
              size="md"
              className="mt-3"
              loading={test.isPending}
              onClick={() => test.mutate()}
            >
              {t('notifications.device.test')}
            </Button>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}

// ── What to hear about, and how ────────────────────────────────────────────────

function Group({ title, text, children }: { title: string; text: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2 id={id} className="mb-1.5 px-4 text-sm font-semibold text-ink-600">
        {title}
      </h2>
      <div className="flex flex-col gap-4 rounded-xl bg-white px-4 py-4 ring-1 ring-inset ring-ink-100">
        <p className="text-sm text-ink-600">{text}</p>
        {children}
      </div>
    </section>
  );
}

/** Two-option pickers sit on 44 px chips, with a check so "on" never relies on colour alone. */
function Toggle({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Chip
      selected={selected}
      disabled={disabled}
      onClick={onClick}
      icon={selected ? CheckIcon : undefined}
      className="h-11! px-4.5! disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </Chip>
  );
}

function Preferences({
  settings,
  device,
  loyaltyOn,
  staff,
  readOnly,
  onChange,
}: {
  settings: NotificationSettings;
  device: DeviceState;
  loyaltyOn: boolean;
  /** Masters and the owner also hear about clients' bookings. */
  staff: boolean;
  readOnly: boolean;
  onChange: (patch: NotificationPrefsPatch) => void;
}) {
  const { t } = useTranslation(['account', 'common']);
  const { locale } = useLocale();
  const { prefs } = settings;
  const leadsId = useId();
  const pushConfigured = settings.push.available;
  // Push can reach this person if this device or another one has it switched on.
  const pushReady = device === 'on' || (device !== 'loading' && settings.push.devices > 0);
  const pushLegend = !pushConfigured
    ? null
    : pushReady
      ? t('notifications.legend.pushOn')
      : device === 'needs-install'
        ? t('notifications.legend.pushInstall')
        : device === 'denied'
          ? t('notifications.legend.pushBlocked')
          : device === 'unsupported'
            ? t('notifications.legend.pushUnsupported')
            : t('notifications.legend.pushOff');

  /** Email / app for one kind of message; the group title names them for screen readers. */
  const channels = (category: Category) => (
    <div className="flex flex-col gap-2">
      <p className="text-[0.9375rem] font-semibold text-ink-900">
        {t('notifications.channels.label')}
      </p>
      <div
        role="group"
        aria-label={t('notifications.channels.label')}
        className="flex flex-wrap gap-2"
      >
        <Toggle
          selected={prefs[category].email}
          disabled={readOnly}
          onClick={() => onChange({ [category]: { email: !prefs[category].email } })}
        >
          {t('notifications.channels.email')}
        </Toggle>
        {pushConfigured ? (
          <Toggle
            selected={pushReady && prefs[category].push}
            disabled={readOnly || !pushReady}
            onClick={() => onChange({ [category]: { push: !prefs[category].push } })}
          >
            {t('notifications.channels.push')}
          </Toggle>
        ) : null}
      </div>
    </div>
  );

  const toggleLead = (lead: ReminderLead) => {
    const current = prefs.reminders.leadMinutes;
    if (current.includes(lead)) {
      if (current.length === 1) {
        toast(t('notifications.reminders.keepOne'), { id: 'keep-one-lead' });
        return;
      }
      onChange({ reminders: { leadMinutes: current.filter((l) => l !== lead) } });
    } else {
      onChange({ reminders: { leadMinutes: [...current, lead].sort((a, b) => a - b) } });
    }
  };

  const consentDate = prefs.marketing.consentAt
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(prefs.marketing.consentAt),
      )
    : null;

  return (
    <>
      <div className="flex flex-col gap-1 px-4 text-sm text-ink-600">
        <p>
          <Trans
            t={t}
            i18nKey="notifications.legend.email"
            values={{ email: settings.email.address }}
            components={{ email: <strong className="break-all font-semibold text-ink-900" /> }}
          />
        </p>
        {pushLegend ? <p>{pushLegend}</p> : null}
      </div>

      <Group title={t('notifications.reminders.title')} text={t('notifications.reminders.text')}>
        <div className={SWITCH_TAP_AREA}>
          <Switch
            label={t('notifications.reminders.enabled')}
            checked={prefs.reminders.enabled}
            disabled={readOnly}
            onChange={(enabled) => onChange({ reminders: { enabled } })}
          />
        </div>
        {prefs.reminders.enabled ? (
          <>
            <div className="flex flex-col gap-2">
              <p id={leadsId} className="text-[0.9375rem] font-semibold text-ink-900">
                {t('notifications.reminders.when')}
              </p>
              <div role="group" aria-labelledby={leadsId} className="flex flex-wrap gap-2">
                {LEADS.map((lead) => (
                  <Toggle
                    key={lead}
                    selected={prefs.reminders.leadMinutes.includes(lead)}
                    disabled={readOnly}
                    onClick={() => toggleLead(lead)}
                  >
                    {t(`notifications.reminders.lead.${lead}`)}
                  </Toggle>
                ))}
              </div>
            </div>
            {channels('reminders')}
          </>
        ) : null}
      </Group>

      {staff ? (
        <Group
          title={t('notifications.staffBookings.title')}
          text={t('notifications.staffBookings.text')}
        >
          {channels('staffBookings')}
        </Group>
      ) : null}

      <Group
        title={t('notifications.bookingUpdates.title')}
        text={t('notifications.bookingUpdates.text')}
      >
        {channels('bookingUpdates')}
      </Group>

      {loyaltyOn ? (
        <Group title={t('notifications.loyalty.title')} text={t('notifications.loyalty.text')}>
          {channels('loyalty')}
        </Group>
      ) : null}

      <Group
        title={t('notifications.marketing.title')}
        text={
          <>
            {t('notifications.marketing.text')}
            {consentDate ? (
              <span className="mt-1 block text-ink-500">
                {t('notifications.marketing.consent', { date: consentDate })}
              </span>
            ) : null}
          </>
        }
      >
        {channels('marketing')}
      </Group>
    </>
  );
}
