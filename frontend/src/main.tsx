import '@/styles/index.css';
// Capture the install prompt before React mounts (it can fire very early).
import '@/lib/pwa';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { initI18n } from '@/i18n';
import { splitLocale } from '@/i18n/routing';
import { listenForPushes } from '@/lib/liveUpdates';
import { isStandalone } from '@/lib/platform';
import { queryClient } from '@/services/queries';

const { locale } = splitLocale(window.location.pathname);

// The dev server never uses a service worker: drop any left over from a production build on
// this address, so what's on screen is always the code being edited.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister();
  });
}

// A push arrives while the app is open: what's on screen is fetched again right away.
listenForPushes(queryClient);

// Installed on the Home Screen: ask the browser to keep this app's data (sign-in, preferences)
// even when the phone runs low on space.
if (isStandalone()) void navigator.storage?.persist?.().catch(() => undefined);

initI18n(locale).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
