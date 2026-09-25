import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Checkbox } from '@/components/ui';
import { CloseIcon, CookieIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import {
  acceptAll,
  acceptMinimal,
  closeConsentSettings,
  saveConsent,
  useConsent,
} from '@/lib/consent';

/**
 * First-party consent card (no third-party service). Three equal-weight choices — Accept all,
 * Minimal, Custom — and a custom view with a tick box per category. Optional categories
 * start unticked; essential is ticked and locked.
 */
export function ConsentBanner() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const { choice, mode } = useConsent();
  const [custom, setCustom] = useState(false);
  const [preferences, setPreferences] = useState(choice?.preferences ?? false);
  const [analytics, setAnalytics] = useState(choice?.analytics ?? false);
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);

  const showCustom = custom || mode === 'custom';
  const visible = mode !== 'hidden' || custom;

  // Opened from settings: reflect the saved choice and move focus into the card.
  useEffect(() => {
    if (mode === 'custom') {
      setPreferences(choice?.preferences ?? false);
      setAnalytics(choice?.analytics ?? false);
      cardRef.current?.focus();
    }
  }, [mode, choice]);

  if (!visible) return null;

  const finish = () => setCustom(false);

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-labelledby={titleId}
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+0.75rem)] z-50 animate-rise outline-none md:inset-x-auto md:bottom-6 md:left-6 md:w-[26rem]"
    >
      <div className="max-h-[80dvh] overflow-y-auto rounded-xl bg-white p-4 shadow-raised ring-1 ring-ink-100">
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
              <Link to={lp('/privacy')} className="font-semibold text-ink-900 underline">
                {t('consent.policy')}
              </Link>
            </p>
          </div>
          {mode === 'custom' && choice ? (
            <button
              type="button"
              onClick={() => {
                closeConsentSettings();
                finish();
              }}
              aria-label={t('actions.close')}
              className="-mr-1 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-[1.2rem] text-ink-600 hover:bg-ink-50"
            >
              <CloseIcon fontSize="inherit" />
            </button>
          ) : null}
        </div>

        {showCustom ? (
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveConsent({ preferences, analytics });
              finish();
            }}
          >
            <Checkbox
              checked
              disabled
              readOnly
              label={
                <span>
                  <span className="font-semibold text-ink-900">{t('consent.essential')}</span>
                  <span className="block text-ink-600">{t('consent.essentialText')}</span>
                </span>
              }
            />
            <Checkbox
              checked={preferences}
              onChange={(e) => setPreferences(e.target.checked)}
              label={
                <span>
                  <span className="font-semibold text-ink-900">{t('consent.preferences')}</span>
                  <span className="block text-ink-600">{t('consent.preferencesText')}</span>
                </span>
              }
            />
            <Checkbox
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              label={
                <span>
                  <span className="font-semibold text-ink-900">{t('consent.analytics')}</span>
                  <span className="block text-ink-600">{t('consent.analyticsText')}</span>
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  acceptMinimal();
                  finish();
                }}
              >
                {t('consent.minimal')}
              </Button>
              <Button size="sm" type="submit">
                {t('consent.save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Button size="sm" variant="outline" className="px-2" onClick={acceptMinimal}>
              {t('consent.minimal')}
            </Button>
            <Button size="sm" variant="outline" className="px-2" onClick={() => setCustom(true)}>
              {t('consent.custom')}
            </Button>
            <Button size="sm" className="px-2" onClick={acceptAll}>
              {t('consent.acceptAll')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
