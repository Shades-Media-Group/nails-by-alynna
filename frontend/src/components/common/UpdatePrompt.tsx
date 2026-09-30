import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from '@/components/ui';
import { newBuildOnServer } from '@/lib/appUpdate';

/** How often an open app asks whether a new build is out (/version.json: a few hundred bytes, never cached). */
const CHECK_EVERY_MS = 60_000;
/** Screens where a reload could lose what the user is typing. */
const BUSY_PATHS = /\/(book|login|signup|forgot-password|reset-password|profile|admin\/(services|team|settings|appointments\/new))/;

/**
 * Keeps the app current after every deploy, without signing anyone out (the session lives in
 * cookies, a reload keeps it). While the app is on screen it asks every minute (and on launch,
 * on coming back to the foreground, on focus and when the connection returns) whether a new build
 * is out; the new version downloads at once and "Update" shows as soon as it is ready. If
 * ignored, it applies itself the next time the app is hidden (unless a form is open).
 */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const apply = useRef<() => void>(() => window.location.reload());
  const onReady = useCallback((update?: () => void) => {
    if (update) apply.current = update;
    setReady(true);
  }, []);
  const applyUpdate = useCallback(() => apply.current(), []);

  return (
    <>
      {import.meta.env.DEV ? <DevVersionWatch onReady={onReady} /> : <ServiceWorkerWatch onReady={onReady} />}
      {ready ? <UpdateToast apply={applyUpdate} /> : null}
    </>
  );
}

/** Production: a new service worker waiting to take over means a new build. */
function ServiceWorkerWatch({ onReady }: { onReady: (update: () => void) => void }) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const fetchUpdate = () => void registration.update().catch(() => undefined);
      // The cheap question first; the service worker is fetched again only when the answer is yes.
      const check = async () => {
        if (!navigator.onLine || document.visibilityState !== 'visible') return;
        // Already downloading or downloaded: "Update" shows (or is showing) on its own.
        if (registration.installing || registration.waiting) return;
        if (await newBuildOnServer()) fetchUpdate();
      };
      void check();
      window.setInterval(() => void check(), CHECK_EVERY_MS);
      window.addEventListener('focus', () => void check());
      window.addEventListener('online', () => void check());
      document.addEventListener('visibilitychange', () => {
        // Back on screen: ask the service worker directly too (it also catches a changed worker
        // alone, with the same version.json).
        if (document.visibilityState === 'visible' && navigator.onLine) fetchUpdate();
      });
    },
  });

  useEffect(() => {
    if (needRefresh) onReady(() => void updateServiceWorker(true));
  }, [needRefresh, onReady, updateServiceWorker]);
  return null;
}

/**
 * Development (the dev server opened on a phone, often from the Home Screen): live edits
 * arrive by hot reload while the app is open; an app resumed from the background compares
 * the dev server's version and offers a reload when files changed meanwhile.
 */
function DevVersionWatch({ onReady }: { onReady: (update?: () => void) => void }) {
  useEffect(() => {
    let known: string | null = null;
    let stopped = false;
    const read = () =>
      fetch('/version.json', { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<{ version?: string }>) : null))
        .then((body) => body?.version ?? null)
        .catch(() => null);
    const check = async () => {
      const current = await read();
      if (stopped || !current) return;
      if (known === null) known = current;
      else if (current !== known) onReady();
    };
    void check();
    // Edits applied by hot reload are already on screen: they are the new baseline.
    const afterHotUpdate = () => {
      known = null;
      void check();
    };
    import.meta.hot?.on('vite:afterUpdate', afterHotUpdate);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    // Only when the app comes back to the screen: while it's open, hot reload keeps it current.
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      import.meta.hot?.off('vite:afterUpdate', afterHotUpdate);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [onReady]);
  return null;
}

function UpdateToast({ apply }: { apply: () => void }) {
  const { t } = useTranslation('common');
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const id = toast(t('update.title'), {
      description: t('update.text'),
      duration: Infinity,
      action: { label: t('update.action'), onClick: apply },
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && !BUSY_PATHS.test(pathRef.current)) apply();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      toast.dismiss(id);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [apply, t]);
  return null;
}
