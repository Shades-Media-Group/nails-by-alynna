import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router/dom';
import { hideSplash } from '@/components/brand/splash';
import { Button, Toaster } from '@/components/ui';
import { RefreshIcon, WarningIcon } from '@/components/ui/icons';
import { queryClient } from '@/services/queries';
import { AuthProvider, useAuth } from './auth';
import { router } from './router';

/** Waits for the session check (under the splash) so guards never flash the wrong screen. */
function AuthGate() {
  const { status, retry } = useAuth();
  const { t } = useTranslation('common');

  if (status === 'loading') return null;
  if (status === 'error') {
    hideSplash();
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-sm">
          <span className="mx-auto mb-6 inline-flex size-16 items-center justify-center rounded-pill bg-peach-50 text-[2rem] text-peach-500">
            <WarningIcon fontSize="inherit" />
          </span>
          <h1 className="text-h2 font-extrabold">{t('errors.boundaryTitle')}</h1>
          <p className="mt-3 text-ink-600">{t('errors.network')}</p>
          <Button className="mt-8" icon={RefreshIcon} onClick={retry}>
            {t('actions.retry')}
          </Button>
        </div>
      </main>
    );
  }
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
