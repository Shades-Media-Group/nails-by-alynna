import { useId, useState } from 'react';
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
  type ConsentChoice,
} from '@/lib/consent';

/**
 * First-party consent card (no third-party service). Three equal-weight choices — Minimal,
 * Custom, Accept all — and a custom view with a tick box per category. Optional categories
 * start unticked; essential is ticked and locked.
 */
export function ConsentBanner() {
  const { t } = useTranslation('common');
  const { lp } = useLocale();
  const { choice, mode } = useConsent();
  const [customLocal, setCustomLocal] = useState(false);
  const titleId = useId();

  const showCustom = customLocal || mode === 'custom';
  if (mode === 'hidden' && !customLocal) return null;

  const close = () => {
    closeConsentSettings();
    setCustomLocal(false);
  };

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+0.75rem)] z-50 animate-rise md:inset-x-auto md:bottom-6 md:left-6 md:w-[26rem]"
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
          {showCustom && choice ? (
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
            {/* Equal weight for "Minimal" and "Accept all": no nudging towards consent. */}
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="soft" onClick={acceptMinimal}>
                {t('consent.minimal')}
              </Button>
              <Button size="sm" variant="soft" onClick={acceptAll}>
                {t('consent.acceptAll')}
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCustomLocal(true)}>
              {t('consent.custom')}
            </Button>
          </div>
        )}
      </div>
    </section>
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
