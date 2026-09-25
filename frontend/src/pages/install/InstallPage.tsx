import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/brand/Logo';
import { QrCode } from '@/components/common/QrCode';
import { Button, ButtonLink, IconButton, SegmentedControl, toast } from '@/components/ui';
import {
  AddBoxIcon,
  ArrowBackIcon,
  CheckCircleIcon,
  CheckIcon,
  ContentCopyIcon,
  InstallIcon,
  IosShareIcon,
  LaptopIcon,
  MoreVertIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { currentPlatform } from '@/lib/platform';
import { useInstallPrompt } from '@/lib/pwa';

type Device = 'iphone' | 'android' | 'computer';

const IN_APP_NAMES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', telegram: 'Telegram', other: '' } as const;

/**
 * /app: how to put the studio on the home screen. Detects the device (iPhone, Android,
 * computer) and in-app browsers, uses the real install prompt where the browser offers one, and
 * gives computers a QR code to continue on the phone. Every device's steps stay one tap away.
 */
export default function InstallPage() {
  const { t } = useTranslation(['install', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const { user } = useAuth();
  const platform = currentPlatform();
  const { canPrompt, installed, prompt } = useInstallPrompt();
  const detected: Device = platform.os === 'ios' || platform.os === 'ipados' ? 'iphone' : platform.os === 'android' ? 'android' : 'computer';
  const [device, setDevice] = useState<Device>(detected);
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
          <p className="mt-2 max-w-md text-[0.9375rem] text-ink-600">{inside ? t('installedText') : t('subtitle')}</p>
          {!inside ? (
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {(t('perks', { returnObjects: true }) as string[]).map((perk) => (
                <li key={perk} className="inline-flex items-center gap-1.5 rounded-pill bg-ink-50 px-3 py-1.5 text-sm font-medium text-ink-700">
                  <CheckIcon fontSize="inherit" className="text-base text-mint-700" />
                  {perk}
                </li>
              ))}
            </ul>
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
                  <Steps icons={[IosShareIcon, AddBoxIcon, CheckCircleIcon]} texts={t('ios', { returnObjects: true }) as string[]} />
                  <p className="mt-4 text-center text-sm text-ink-600">{t('iosChrome')}</p>
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
                    <Steps icons={[MoreVertIcon, InstallIcon, CheckCircleIcon]} texts={t('androidManual', { returnObjects: true }) as string[]} />
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
                  <div className="flex max-w-xs flex-col items-center gap-3 text-center md:items-start md:pt-6 md:text-left">
                    <span className="inline-flex size-11 items-center justify-center rounded-pill bg-ink-50 text-2xl text-ink-800">
                      <LaptopIcon fontSize="inherit" />
                    </span>
                    {canPrompt && detected === 'computer' ? (
                      <Button size="md" icon={InstallIcon} onClick={() => void install()}>
                        {t('desktopInstall')}
                      </Button>
                    ) : (
                      <p className="text-sm text-ink-600">{t('desktopManual')}</p>
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

/** Numbered steps with the icon the visitor will actually see on their screen. */
function Steps({ icons, texts }: { icons: IconComponent[]; texts: string[] }) {
  return (
    <ol className="mx-auto flex max-w-md flex-col gap-3">
      {texts.map((text, index) => {
        const Icon = icons[index] ?? CheckCircleIcon;
        return (
          <li
            key={text}
            className={cx('stagger flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-inset ring-ink-100')}
            style={{ ['--i' as string]: index }}
          >
            <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-sm font-bold text-white">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 text-[0.9375rem] leading-snug">{text}</span>
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-blush-100 text-xl text-rose-700">
              <Icon fontSize="inherit" />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
