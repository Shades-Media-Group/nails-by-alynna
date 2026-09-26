import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { toast } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { enablePush, readPushState, type PushState } from '@/lib/push';
import { markPromptDone } from '@/lib/pushPrompt';
import {
  notificationsApi,
  type NotificationPrefsPatch,
  type NotificationSettings,
} from '@/services/api/endpoints';
import { NOTIFICATIONS_KEY, notificationsQuery, outcomeMessage, usePushDevice } from './pushDevice';

/**
 * "Turn on notifications", wherever it is offered: the permission prompt (in the tap), this
 * device's subscription, and optionally preferences switched on in the same go (one PATCH),
 * then a short message saying how it went.
 */
export function useTurnOnPush() {
  const { t } = useTranslation(['push', 'common']);
  const { user } = useAuth();
  const { lp } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signedIn = Boolean(user && !user.isDemo);
  const settings = useQuery({ ...notificationsQuery(), enabled: signedIn });
  const [device, setDevice] = usePushDevice(
    signedIn ? user?.id : undefined,
    settings.data?.push.available,
  );
  const [busy, setBusy] = useState(false);
  const userId = user?.id;
  const publicKey = settings.data?.push.publicKey;

  /** Call it straight from the tap: nothing may be awaited before the permission prompt. */
  const turnOn = useCallback(
    async (patch?: NotificationPrefsPatch): Promise<PushState | null> => {
      if (!userId) return null;
      const enabling = enablePush(userId, { publicKey });
      setBusy(true);
      try {
        const state = await enabling;
        setDevice(state);
        // Turned on, or blocked: the sheet never needs to ask again on this device.
        if (state === 'on' || state === 'denied') markPromptDone(userId);
        if (state === 'on' && patch) {
          try {
            const prefs = await notificationsApi.update(patch);
            queryClient.setQueryData<NotificationSettings>(NOTIFICATIONS_KEY, (old) =>
              old ? { ...old, prefs } : old,
            );
          } catch (error) {
            console.warn('[push] preferences not saved', error);
            toast.error(t('push:result.saveFailed'));
            return state;
          }
        }
        const message = outcomeMessage(t, state);
        if (message?.tone === 'success') toast.success(message.text);
        else if (message?.tone === 'error') toast.error(message.text);
        else if (message && state === 'needs-install')
          toast(message.text, {
            action: { label: t('push:hint.installLink'), onClick: () => void navigate(lp('/app')) },
          });
        else if (message) toast(message.text);
        return state;
      } catch (error) {
        toast.error(errorMessage(t, error));
        setDevice(await readPushState(userId).catch(() => 'off' as const));
        return null;
      } finally {
        setBusy(false);
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      }
    },
    [userId, publicKey, setDevice, queryClient, t, navigate, lp],
  );

  return { device, setDevice, busy, turnOn, settings };
}
