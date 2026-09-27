import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { STAFF_ROLES, useAuth } from '@/app/auth';
import { Button, Sheet } from '@/components/ui';
import { CheckIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { splitLocale } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { introSeen } from '@/lib/intro';
import {
  CLIENT_DELAY_MS,
  CLIENT_IDLE_MS,
  CLIENT_PROMPT_PAGES,
  STAFF_DELAY_MS,
  afterNotNow,
  currentOpening,
  optedOutOfPush,
  promptFor,
  promptPrefsPatch,
  readSchedule,
  saveSchedule,
  type PromptAudience,
  type PromptKind,
} from '@/lib/pushPrompt';
import type { DeviceState } from '@/lib/push';
import { SHEET_ORDER, useSheetTurn } from '@/lib/sheetQueue';
import type { NotificationSettings } from '@/services/api/endpoints';
import type { User } from '@/types/api';
import { onPhone } from './pushDevice';
import { useTurnOnPush } from './useTurnOnPush';

/** Staff: the app opening in which the sheet was last closed (lib/pushPrompt.ts currentOpening). */
let staffClosedInOpening: number | null = null;
/** Clients asked in this app open (at most once per open, whatever came of it). */
const clientsAskedThisOpen = new Set<string>();

/** Any dialog already on screen (a sheet, the first-run intro): the ask never goes on top of it. */
const otherDialogOpen = () =>
  document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null;

/** How often the sheet looks whether it's time (the app's age, the last touch, the page). */
const CHECK_EVERY_MS = 1_000;

/**
 * The sheet that asks for notifications (rules and timing in lib/pushPrompt.ts): clients in the
 * client app, staff in the staff app. Its one button asks for permission in that tap, subscribes
 * this device and switches the service messages on by app and email in one request.
 */
export function PushPrompt({ audience }: { audience: PromptAudience }) {
  const { user } = useAuth();
  if (!user || user.isDemo) return null;
  const staff = STAFF_ROLES.includes(user.role);
  if (staff !== (audience === 'staff')) return null;
  return <PromptHost key={user.id} user={user} audience={audience} />;
}

interface Facts {
  data: NotificationSettings | undefined;
  device: DeviceState;
  pathname: string;
  shown: PromptKind | null;
  myTurn: boolean;
}

function PromptHost({ user, audience }: { user: User; audience: PromptAudience }) {
  const { t } = useTranslation(['push', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { device, busy, turnOn, settings } = useTurnOnPush();
  const studio = useStudio().data;
  const staff = audience === 'staff';
  const data = settings.data;
  /** What would be asked now, whatever the moment (the rules alone). */
  const [kind, setKind] = useState<PromptKind | null>(null);
  /** …and the moment is right (idle on the right page). */
  const [ready, setReady] = useState(false);
  /** On screen. */
  const [shown, setShown] = useState<PromptKind | null>(null);

  // Staff hold their place in the sheet queue from the start (while still deciding), so a
  // sheet that opens with the staff app waits for this one; clients only when about to ask.
  const undecided = !data || device === 'loading';
  const wanted =
    shown !== null || (staff ? !settings.isError && (undecided || kind !== null) : ready);
  const myTurn = useSheetTurn('notifications', SHEET_ORDER.notifications, wanted);

  // The timer below reads the latest of these.
  const facts = useRef<Facts>({ data, device, pathname, shown, myTurn });
  useEffect(() => {
    facts.current = { data, device, pathname, shown, myTurn };
  });

  useEffect(() => {
    const opened = Date.now();
    let touched = opened;
    const onTouch = () => {
      touched = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const type of events)
      window.addEventListener(type, onTouch, { capture: true, passive: true });

    const check = () => {
      const { data, device, pathname, shown, myTurn } = facts.current;
      if (shown || (!staff && clientsAskedThisOpen.has(user.id))) return;
      const now = Date.now();
      const next =
        data && device !== 'loading'
          ? promptFor({
              audience,
              device,
              serverPush: data.push.available,
              optedOut: optedOutOfPush(data.prefs, audience),
              schedule: readSchedule(user.id),
              snoozed: staffClosedInOpening === currentOpening(),
              now,
            })
          : null;
      const page = splitLocale(pathname).rest;
      const quiet = staff
        ? now - opened >= STAFF_DELAY_MS
        : now - opened >= CLIENT_DELAY_MS && now - touched >= CLIENT_IDLE_MS;
      const rightPage = staff ? page.startsWith('/admin') : CLIENT_PROMPT_PAGES.includes(page);
      const moment = next !== null && quiet && rightPage && (staff || introSeen(user));
      setKind(next);
      setReady(moment);
      if (moment && myTurn && !otherDialogOpen()) {
        if (!staff) clientsAskedThisOpen.add(user.id);
        setShown(next);
      }
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      for (const type of events) window.removeEventListener(type, onTouch, { capture: true });
    };
  }, [audience, staff, user]);

  /** "Not now", the close button, a tap outside or a swipe down. */
  const notNow = useCallback(() => {
    setShown(null);
    setReady(false);
    if (staff) staffClosedInOpening = currentOpening();
    else saveSchedule(user.id, afterNotNow(readSchedule(user.id), Date.now()));
  }, [staff, user.id]);

  const enable = async () => {
    // First thing in the tap: the permission prompt needs the user's gesture.
    const state = await turnOn(promptPrefsPatch(audience));
    setShown(null);
    setReady(false);
    // Whatever came of it, staff are asked again on the next open, not right away.
    if (staff) staffClosedInOpening = currentOpening();
    // Closed the phone's own prompt without choosing: like "Not now".
    else if (state === 'off') saveSchedule(user.id, afterNotNow(readSchedule(user.id), Date.now()));
  };

  const showHowToInstall = () => {
    setShown(null);
    setReady(false);
    if (staff) staffClosedInOpening = currentOpening();
    else saveSchedule(user.id, { ...readSchedule(user.id), installShown: true });
    void navigate(lp('/app'));
  };

  const install = shown === 'install';
  const title = install
    ? t('prompt.installTitle')
    : staff
      ? t('prompt.staffTitle')
      : t('prompt.clientTitle');
  const points = install
    ? []
    : staff
      ? [t('prompt.staffPoints.requests'), t('prompt.staffPoints.changes')]
      : [
          studio?.booking.requireApproval === false
            ? t('prompt.clientPoints.changes')
            : t('prompt.clientPoints.confirm'),
          t('prompt.clientPoints.remind'),
          // Loyalty messages only while the studio runs the stamp card.
          ...(studio?.loyalty.enabled === false ? [] : [t('prompt.clientPoints.loyalty')]),
        ];

  return (
    <Sheet
      open={shown !== null}
      onClose={notNow}
      title={title}
      description={
        install
          ? t('prompt.installText')
          : staff
            ? t('prompt.staffText')
            : onPhone()
              ? t('prompt.clientText')
              : t('prompt.clientTextDevice')
      }
      footer={
        <div className="flex flex-col gap-2">
          {install ? (
            <Button fullWidth onClick={showHowToInstall}>
              {t('prompt.installAction')}
            </Button>
          ) : (
            <Button fullWidth loading={busy} onClick={() => void enable()}>
              {t('prompt.enable')}
            </Button>
          )}
          <Button variant="ghost" size="md" fullWidth disabled={busy} onClick={notNow}>
            {t('prompt.later')}
          </Button>
        </div>
      }
    >
      {points.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-[0.9375rem] text-ink-800">
              <span
                className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill bg-mint-100 text-sm text-mint-700"
                aria-hidden="true"
              >
                <CheckIcon fontSize="inherit" />
              </span>
              <span className="first-letter:uppercase">{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}
