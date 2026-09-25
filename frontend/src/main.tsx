import '@/styles/index.css';
// Capture the install prompt before React mounts (it can fire very early).
import '@/lib/pwa';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { initI18n } from '@/i18n';
import { splitLocale } from '@/i18n/routing';

const { locale } = splitLocale(window.location.pathname);

initI18n(locale).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
