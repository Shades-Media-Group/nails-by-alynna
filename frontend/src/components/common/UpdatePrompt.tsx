import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from '@/components/ui';

const CHECK_EVERY_MS = 30 * 60_000;
/** Screens where a reload could lose what the user is typing. */
const BUSY_PATHS = /\/(book|signup|reset-password|admin\/(services|team|settings))/;

/**
 * Keeps installed apps current after every deploy: checks for a new service worker on
 * launch, every 30 minutes and whenever the app comes back to the foreground. When one is
 * waiting it offers "Update"; if ignored, it applies itself the next time the app is hidden
 * (unless the user is in the middle of a form).
 */
export function UpdatePrompt() {
  const { t } = useTranslation('common');
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (!navigator.onLine) return;
        void registration.update().catch(() => undefined);
      };
      window.setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast(t('update.title'), {
      description: t('update.text'),
      duration: Infinity,
      action: { label: t('update.action'), onClick: () => void updateServiceWorker(true) },
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && !BUSY_PATHS.test(pathRef.current)) {
        void updateServiceWorker(true);
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      toast.dismiss(id);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [needRefresh, t, updateServiceWorker]);

  return null;
}
