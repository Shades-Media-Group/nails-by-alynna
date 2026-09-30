import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { QrCode } from '@/components/common/QrCode';
import { Button, ButtonLink, IconButton, SegmentedControl, toast } from '@/components/ui';
import { ArrowBackIcon, CheckCircleIcon, CheckIcon, ContentCopyIcon, ExpandMoreIcon, InfoIcon, InstallIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { currentPlatform } from '@/lib/platform';
import { useInstallPrompt } from '@/lib/pwa';
import { HIGHLIGHT, highlightDelay } from './highlight';
import { IOS_SHOTS, type Mark, type Shot } from './iosShots';

// Drawings load only with their device's steps (the iPhone pictures are plain image URLs).
const AndroidArt = lazy(() => import('./AndroidArt'));
const DesktopArt = lazy(() => import('./DesktopArt'));

type Device = 'iphone' | 'android' | 'computer';

const IN_APP_NAMES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', telegram: 'Telegram', other: '' } as const;

/**
 * /app: how to put the studio on the home screen. Detects the device (iPhone, Android,
 * computer) and in-app browsers, uses the real install prompt where the browser offers one, and
 * gives computers a QR code to continue on the phone. Every device's steps stay one tap away.
 */
export default function InstallPage() {
  const { t } = useTranslation(['install', 'common']);
  const { locale, lp } = useLocale();
  const navigate = useNavigate();
  const { user } = useAuth();
  const platform = currentPlatform();
  const { canPrompt, installed, prompt } = useInstallPrompt();
  const detected: Device = platform.os === 'ios' || platform.os === 'ipados' ? 'iphone' : platform.os === 'android' ? 'android' : 'computer';
  const [device, setDevice] = useState<Device>(detected);
  // What the app gives, behind the ⓘ for now; the guide below comes first.
  const [perksOpen, setPerksOpen] = useState(false);
  const appUrl = typeof window === 'undefined' ? '' : `${window.location.origin}${lp('/app')}`;
  const home = lp(user ? '/home' : '/login');

  const install = async () => {
    const outcome = await prompt();
    if (outcome === 'accepted') toast.success(t('installedToast'));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      toast.success(t('copied'));
    } catch {
      toast.error(t('common:errors.generic'));
    }
  };

  // Opened from the Home Screen icon: this is already the app, so go straight in.
  if (platform.standalone) return <Navigate to={home} replace />;
  const inside = installed;

  return (
    <div className="min-h-dvh bg-white">
      <header className="gutter-x mx-auto flex h-14 max-w-3xl items-center justify-between pt-[var(--safe-top)]">
        <IconButton
          icon={ArrowBackIcon}
          label={t('common:actions.back')}
          size="sm"
          variant="soft"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(home, { replace: true }))}
        />
        <Logo variant="mark" className="w-11" />
        <span className="size-9" aria-hidden="true" />
      </header>

      <main className="gutter-x mx-auto max-w-3xl pb-[calc(var(--safe-bottom)+2.5rem)] pt-4 animate-page">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-24 items-center justify-center rounded-[1.6rem] bg-blush-100 shadow-raised">
            <Logo variant="mark" className="w-16" />
          </span>
          <h1 className="mt-5 text-h1 font-extrabold lg:text-[2.25rem]">{inside ? t('installed') : t('title')}</h1>
          <p className="mt-2 max-w-md text-[0.9375rem] text-ink-600">
            {inside ? t('installedText') : t('subtitle')}
            {!inside ? (
              <button
                type="button"
                aria-expanded={perksOpen}
                aria-controls="install-perks"
                aria-label={t('perksToggle')}
                title={t('perksToggle')}
                onClick={() => setPerksOpen((open) => !open)}
                className={cx(
                  'press -my-2 ml-0.5 inline-flex size-9 items-center justify-center rounded-pill align-middle text-lg transition-colors duration-150',
                  perksOpen ? 'bg-ink-100 text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
                )}
              >
                <InfoIcon fontSize="inherit" />
              </button>
            ) : null}
          </p>
          {!inside ? (
            perksOpen ? (
              <ul id="install-perks" className="mt-4 flex flex-wrap justify-center gap-2 animate-rise">
                {(t('perks', { returnObjects: true }) as string[]).map((perk) => (
                  <li key={perk} className="inline-flex items-center gap-1.5 rounded-pill bg-ink-50 px-3 py-1.5 text-sm font-medium text-ink-700">
                    <CheckIcon fontSize="inherit" className="text-base text-mint-700" />
                    {perk}
                  </li>
                ))}
              </ul>
            ) : (
              <p id="install-perks" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-700">
                {t(`guideBelow.${device}`)}
                <ExpandMoreIcon aria-hidden="true" fontSize="inherit" className="text-lg" />
              </p>
            )
          ) : null}
        </div>

        {inside ? (
          <div className="mt-8 flex justify-center">
            <ButtonLink to={home} replace trailingIcon={undefined} icon={CheckCircleIcon}>
              {t('toHome')}
            </ButtonLink>
          </div>
        ) : (
          <>
            {platform.inApp ? (
              <div className="mt-8 rounded-2xl bg-peach-50 p-4 text-sm text-peach-800 animate-rise">
                <p>{t('inApp', { app: IN_APP_NAMES[platform.inApp] || 'this app' })}</p>
                <Button size="sm" variant="outline" icon={ContentCopyIcon} className="mt-3 bg-white" onClick={() => void copy()}>
                  {t('copyLink')}
                </Button>
              </div>
            ) : null}

            <div className="mt-8 flex justify-center">
              <SegmentedControl<Device>
                label={t('device')}
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'iphone', label: t('iphone') },
                  { value: 'android', label: t('android') },
                  { value: 'computer', label: t('computer') },
                ]}
              />
            </div>

            <section key={device} className="mt-6 animate-page" aria-labelledby="steps-title">
              <h2 id="steps-title" className="sr-only">
                {t('steps')}
              </h2>

              {device === 'iphone' ? (
                <>
                  <Steps
                    texts={t('ios', { returnObjects: true }) as string[]}
                    picture={(step, alt) => <ShotPicture shot={IOS_SHOTS[locale][step]!} alt={alt} step={step} />}
                    alts={t('iosAlt', { returnObjects: true }) as string[]}
                  />
                  <Notes lines={[t('iosToolbar'), t('iosChrome')]} />
                </>
              ) : null}

              {device === 'android' ? (
                <>
                  {canPrompt && detected === 'android' ? (
                    <div className="flex flex-col items-center gap-3">
                      <Button size="lg" icon={InstallIcon} onClick={() => void install()} className="w-full max-w-sm">
                        {t('installButton')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Steps
                        texts={t('androidManual', { returnObjects: true }) as string[]}
                        picture={(step, alt) => (
                          <Frame ratio="16 / 10">
                            <AndroidArt step={step} alt={alt} />
                          </Frame>
                        )}
                        alts={t('androidAlt', { returnObjects: true }) as string[]}
                      />
                      <Notes lines={[t('androidOther')]} />
                    </>
                  )}
                </>
              ) : null}

              {device === 'computer' ? (
                <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:justify-center md:gap-10">
                  <div className="flex flex-col items-center text-center">
                    <QrCode value={appUrl} label={t('qrTitle')} className="size-48 p-2 ring-1 ring-ink-100" />
                    <h3 className="mt-3 font-bold">{t('qrTitle')}</h3>
                    <p className="mt-1 max-w-64 text-sm text-ink-600">{t('qrText')}</p>
                  </div>
                  <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center md:items-start md:pt-2 md:text-left">
                    {canPrompt && detected === 'computer' ? (
                      <Button size="md" icon={InstallIcon} onClick={() => void install()}>
                        {t('desktopInstall')}
                      </Button>
                    ) : (
                      <>
                        <Frame ratio="16 / 7">
                          <DesktopArt alt={t('desktopAlt')} />
                        </Frame>
                        <p className="text-[0.9375rem] leading-snug">{t('desktopManual')}</p>
                        <p className="text-sm text-ink-600">{t('desktopMenu')}</p>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Numbered steps, each with a picture of what the visitor will see and our mark on what to tap:
 * under the text on phones, beside it from sm up. Pictures keep their aspect ratio (no shift).
 */
function Steps({ texts, alts, picture }: { texts: string[]; alts: string[]; picture: (step: number, alt: string) => ReactNode }) {
  return (
    <ol className="mx-auto flex max-w-md flex-col gap-3 sm:max-w-2xl">
      {texts.map((text, index) => (
        <li
          key={text}
          className="stagger rounded-2xl bg-white p-3 ring-1 ring-inset ring-ink-100 sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:items-center sm:gap-5 sm:p-4"
          style={{ ['--i' as string]: index }}
        >
          <div className="flex items-start gap-3">
            <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-sm font-bold text-white">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 pt-1 text-[0.9375rem] leading-snug">{text}</p>
          </div>
          <div className="mt-3 sm:mt-0">{picture(index, alts[index] ?? '')}</div>
        </li>
      ))}
    </ol>
  );
}

/** Fixed-ratio frame for a step picture; a drawing still loading leaves the same box. */
function Frame({ ratio, maxWidth, children }: { ratio: string; maxWidth?: number; children: ReactNode }) {
  return (
    <figure
      className="@container relative mx-auto w-full overflow-hidden rounded-md bg-ink-50 ring-1 ring-ink-100"
      style={{ aspectRatio: ratio, maxWidth }}
    >
      <Suspense fallback={null}>{children}</Suspense>
    </figure>
  );
}

const MARK_SHAPE: Record<Mark['shape'], string> = { circle: 'rounded-full', pill: 'rounded-pill', icon: 'rounded-[26%]' };

/** A screenshot, shown at most at its own size, with our mark drawn over the control to tap. */
function ShotPicture({ shot, alt, step }: { shot: Shot; alt: string; step: number }) {
  const { mark } = shot;
  const place: CSSProperties = { left: `${mark.x}%`, top: `${mark.y}%`, width: `${mark.w}%`, height: `${mark.h}%`, ...highlightDelay(step) };
  return (
    <Frame ratio={`${shot.width} / ${shot.height}`} maxWidth={shot.width / 2}>
      <img src={shot.src} width={shot.width} height={shot.height} alt={alt} loading="lazy" decoding="async" draggable={false} className="block size-full select-none" />
      <span aria-hidden="true" className={cx('pointer-events-none absolute', MARK_SHAPE[mark.shape], HIGHLIGHT)} style={place} />
    </Frame>
  );
}

function Notes({ lines }: { lines: string[] }) {
  return (
    <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-center text-sm text-ink-600 sm:max-w-xl">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
