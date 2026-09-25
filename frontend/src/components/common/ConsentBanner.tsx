import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isSplashGone, onSplashGone } from '@/components/brand/splash';
import { Button, Checkbox } from '@/components/ui';
import { CloseIcon, CookieIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import {
  acceptAll,
  acceptMinimal,
  closeConsentSettings,
  saveConsent,
  useConsent,
  type ConsentChoice,
} from '@/lib/consent';

/**
 * First-party consent dialog (no third-party service). Shown as a modal over a blurred page
 * until the visitor chooses: Minimal / Custom / Accept all. Custom offers a tick box per
 * category — essential is ticked and locked, optional ones start unticked.
 * Native <dialog> + showModal(): focus is trapped and the page behind is inert.
 */
export function ConsentBanner() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const { choice, mode } = useConsent();
  const splashGone = useSyncExternalStore(onSplashGone, isSplashGone, isSplashGone);
  const [customLocal, setCustomLocal] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const showCustom = customLocal || mode === 'custom';
  const visible = (mode !== 'hidden' || customLocal) && splashGone;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (visible && !dialog.open) dialog.showModal();
    if (!visible && dialog.open) dialog.close();
  }, [visible]);

  if (!visible) return null;

  const dismissible = Boolean(choice);
  const close = () => {
    closeConsentSettings();
    setCustomLocal(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="consent-banner"
      onCancel={(event) => {
        // A first-time choice is required; Escape only closes the reopened settings.
        event.preventDefault();
        if (dismissible) close();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none bg-transparent p-3 pb-[calc(var(--safe-bottom)+0.75rem)] backdrop:bg-ink-900/35 backdrop:backdrop-blur-[6px] open:animate-rise md:inset-0 md:m-auto md:h-fit md:w-[27rem] md:p-0"
    >
      <div className="max-h-[85dvh] overflow-y-auto rounded-xl bg-white p-4 shadow-raised md:p-5">
        <div className="flex gap-3">
          <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-peach-50 text-[1.2rem] text-peach-700">
            <CookieIcon fontSize="inherit" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[0.9375rem] font-bold">
              {showCustom ? t('consent.settingsTitle') : t('consent.title')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              {showCustom ? t('consent.settingsText') : t('consent.text')}{' '}
              <Link to={lp('/privacy')} onClick={() => dismissible && close()} className="font-semibold text-ink-900 underline">
                {t('consent.policy')}
              </Link>
            </p>
          </div>
          {showCustom && dismissible ? (
            <button
              type="button"
              onClick={close}
              aria-label={t('actions.close')}
              className="-mr-1 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-[1.2rem] text-ink-600 hover:bg-ink-50"
            >
              <CloseIcon fontSize="inherit" />
            </button>
          ) : null}
        </div>

        {showCustom ? (
          <CustomChoices key={choice?.decidedAt ?? 'new'} initial={choice} onDone={() => setCustomLocal(false)} />
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={acceptMinimal}>
                {t('consent.minimal')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCustomLocal(true)}>
                {t('consent.custom')}
              </Button>
            </div>
            <Button size="md" fullWidth onClick={acceptAll}>
              {t('consent.acceptAll')}
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}

/** Tick boxes per category; state starts from the saved choice each time it opens. */
function CustomChoices({ initial, onDone }: { initial: ConsentChoice | null; onDone: () => void }) {
  const { t } = useTranslation('common');
  const [preferences, setPreferences] = useState(initial?.preferences ?? false);
  const [analytics, setAnalytics] = useState(initial?.analytics ?? false);

  const category = (title: string, text: string) => (
    <span>
      <span className="font-semibold text-ink-900">{title}</span>
      <span className="block text-ink-600">{text}</span>
    </span>
  );

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        saveConsent({ preferences, analytics });
        onDone();
      }}
    >
      <Checkbox checked disabled readOnly label={category(t('consent.essential'), t('consent.essentialText'))} />
      <Checkbox
        checked={preferences}
        onChange={(e) => setPreferences(e.target.checked)}
        label={category(t('consent.preferences'), t('consent.preferencesText'))}
      />
      <Checkbox
        checked={analytics}
        onChange={(e) => setAnalytics(e.target.checked)}
        label={category(t('consent.analytics'), t('consent.analyticsText'))}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            acceptMinimal();
            onDone();
          }}
        >
          {t('consent.minimal')}
        </Button>
        <Button size="sm" type="submit">
          {t('consent.save')}
        </Button>
      </div>
    </form>
  );
}
