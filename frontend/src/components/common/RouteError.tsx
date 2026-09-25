import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { hideSplash } from '@/components/brand/splash';
import { Button } from '@/components/ui';
import { RefreshIcon, WarningIcon } from '@/components/ui/icons';

/** Last-resort screen for render errors and failed lazy chunks (e.g. after a deploy). */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation('common');
  useEffect(() => {
    hideSplash();
    console.error('[route error]', error);
  }, [error]);

  const chunkFailed =
    error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message);
  if (chunkFailed && !sessionStorage.getItem('nba:reloaded-for-chunk')) {
    // A new version was deployed while the app was open: reload once to pick it up.
    sessionStorage.setItem('nba:reloaded-for-chunk', '1');
    window.location.reload();
    return null;
  }

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="grid min-h-dvh place-items-center bg-white px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-6 inline-flex size-16 items-center justify-center rounded-pill bg-peach-50 text-[2rem] text-peach-500">
          <WarningIcon fontSize="inherit" />
        </span>
        <h1 className="text-h2 font-extrabold">{notFound ? t('errors.notFoundTitle') : t('errors.boundaryTitle')}</h1>
        <p className="mt-3 text-ink-600">{notFound ? t('errors.notFoundText') : t('errors.boundaryText')}</p>
        <Button className="mt-8" icon={RefreshIcon} onClick={() => window.location.assign('/')}>
          {t('actions.reload')}
        </Button>
      </div>
    </main>
  );
}
