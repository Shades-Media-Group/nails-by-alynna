import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { StampCard } from '@/components/loyalty/StampCard';
import { Avatar, Button } from '@/components/ui';
import {
  AddBoxIcon,
  ArrowForwardIcon,
  CalendarAddIcon,
  CheckIcon,
  CloseIcon,
  EventIcon,
  LoyaltyIcon,
  NotificationsIcon,
  ReplayIcon,
  ScheduleIcon,
} from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import { LOCALE_TAGS } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { formatPrice } from '@/lib/format';
import { introSeen, introSeenOnlyHere, markIntroSeen } from '@/lib/intro';
import { ordinal } from '@/lib/ordinal';
import { isStandalone } from '@/lib/platform';
import { lockScroll } from '@/lib/scroll-lock';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import { meApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';
import type { LoyaltyReward, LoyaltyStatus, ServiceArt, User } from '@/types/api';

type SlideKey = 'book' | 'visits' | 'loyalty' | 'home' | 'ready';

const order = (i: number) => ({ '--i': i }) as CSSProperties;

/** Each screen has its own brand field; the colour glides from one to the next. */
const SCENE_FIELD: Record<SlideKey, string> = {
  book: 'bg-blush-100',
  visits: 'bg-cyan-50',
  loyalty: 'bg-peach-50',
  home: 'bg-lilac-50',
  ready: 'bg-mint-50',
};

/**
 * First-run intro for a new client: what the app does, told with pieces of the app itself (the
 * studio's real services and prices, a visit ticket, the loyalty card, the Home Screen icon).
 * Segmented progress at the top, close in the corner, one Continue button; swipe and arrow keys
 * work too. Shown once per client account (any device); the shared demo account on every sign-in.
 */
export function Onboarding({ user }: { user: User }) {
  const [open, setOpen] = useState(() => !introSeen(user));
  // Seen on this device before the API kept track: tell it, so other devices skip it too.
  const syncNeeded = introSeenOnlyHere(user);
  useEffect(() => {
    if (syncNeeded) meApi.markOnboarded().catch(() => {});
  }, [syncNeeded]);
  if (!open) return null;
  return (
    <OnboardingDialog
      onDone={() => {
        markIntroSeen(user);
        // Best effort: this device remembers it anyway.
        if (!user.isDemo) meApi.markOnboarded().catch(() => {});
        setOpen(false);
      }}
    />
  );
}

function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation(['onboarding', 'loyalty']);
  const { locale } = useLocale();
  const { data: config } = useStudio();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);

  const loyalty = config?.loyalty;
  const slides: SlideKey[] = [
    'book',
    'visits',
    ...(loyalty?.enabled && loyalty.rewards.length > 0 ? (['loyalty'] as const) : []),
    isStandalone() ? 'ready' : 'home',
  ];
  const last = index === slides.length - 1;
  const slide = slides[index]!;

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= slides.length) return onDone();
    setDirection(next > index ? 1 : -1);
    setIndex(next);
  };

  useEffect(() => {
    const release = lockScroll();
    root.current?.focus({ preventScroll: true });
    return release;
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') onDone();
    if (event.key === 'ArrowRight') go(index + 1);
    if (event.key === 'ArrowLeft') go(index - 1);
  };
  const onTouchStart = (event: TouchEvent) => {
    const p = event.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const p = event.changedTouches[0];
    touch.current = null;
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.clientY - start.y) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  const enter = direction > 0 ? 'animate-[slide-in-right_440ms_var(--ease-out)_backwards]' : 'animate-[slide-in-left_440ms_var(--ease-out)_backwards]';

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label={t('label')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[60] flex justify-center bg-ink-900/40 outline-none animate-fade-in sm:items-center"
    >
      {/* Full screen on phones; a phone-sized card on wider screens. */}
      <div
        className={cx(
          'relative flex h-full w-full flex-col overflow-hidden transition-colors duration-500 ease-(--ease-out)',
          'sm:h-[min(52rem,calc(100dvh-3rem))] sm:max-w-[26rem] sm:rounded-[2.25rem] sm:shadow-float',
          SCENE_FIELD[slide],
        )}
      >
        <div className="relative z-10 flex items-center gap-4 px-5 pt-[calc(var(--safe-top)+0.875rem)]">
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {slides.map((key, i) => (
              <span key={key} className="h-1 flex-1 overflow-hidden rounded-pill bg-ink-900/12">
                <span
                  className={cx(
                    'block h-full rounded-pill bg-ink-900 transition-[width] duration-500 ease-(--ease-out)',
                    i <= index ? 'w-full' : 'w-0',
                  )}
                />
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onDone}
            aria-label={t('skip')}
            className="press -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-white/80 text-xl text-ink-800 hover:bg-white"
          >
            <CloseIcon fontSize="inherit" />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {t('step', { current: index + 1, total: slides.length })}
        </p>

        <div key={`${slide}-scene`} className="relative min-h-0 flex-1" aria-hidden="true">
          <Scene slide={slide} rewards={loyalty?.rewards ?? []} />
        </div>

        <div className="relative z-10 -mt-6 rounded-t-[2rem] bg-white px-6 pb-[calc(var(--safe-bottom)+1rem)] pt-7 shadow-[0_-18px_40px_-26px_rgb(37_39_38/0.4)] sm:pb-6">
          <div key={`${slide}-text`} className={enter}>
            <h2 id={titleId} className="text-[1.875rem] font-extrabold leading-[1.05] tracking-[-0.035em]">
              <span className="block text-ink-900">{t(`${slide}.title`)}</span>
              <span className="block text-rose-500">{t(`${slide}.accent`)}</span>
            </h2>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-600">{t(`${slide}.text`)}</p>
            {slide === 'loyalty' && loyalty ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {loyalty.rewards.map((reward) => (
                  <li
                    key={reward.visit}
                    className="rounded-pill bg-rose-50 px-3.5 py-1.5 text-[0.9375rem] font-semibold text-rose-700 first-letter:uppercase"
                  >
                    {ordinal(reward.visit, locale)} {t('visit')} · −{reward.percent}%
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button fullWidth size="lg" className="mt-6" trailingIcon={last ? ArrowForwardIcon : undefined} onClick={() => go(index + 1)}>
            {last ? t('start') : t('next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Scene({ slide, rewards }: { slide: SlideKey; rewards: LoyaltyReward[] }) {
  if (slide === 'book') return <BookScene />;
  if (slide === 'visits') return <VisitsScene />;
  if (slide === 'loyalty') return <LoyaltyScene rewards={rewards} />;
  if (slide === 'ready') return <ReadyScene />;
  return <HomeScene />;
}

/** A floating piece of the app, rising into place one after another. */
function Piece({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <div className={cx('stagger absolute', className)} style={order(i)}>
      {children}
    </div>
  );
}

function Chip({ icon: Icon, children, tone = 'white' }: { icon: typeof CheckIcon; children: ReactNode; tone?: 'white' | 'ink' | 'mint' | 'rose' }) {
  const tones = {
    white: 'bg-white text-ink-900',
    ink: 'bg-ink-900 text-white',
    mint: 'bg-mint-50 text-mint-700 ring-1 ring-inset ring-mint-100',
    rose: 'bg-rose-500 text-white',
  } as const;
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 py-2 text-sm font-semibold shadow-card', tones[tone])}>
      <Icon fontSize="inherit" className="text-base" />
      {children}
    </span>
  );
}

/** Book: three of the studio's popular services, one picked, a time and a master. */
function BookScene() {
  const { t } = useTranslation(['onboarding', 'common']);
  const pick = useI18nText();
  const catalog = useCatalog();
  const { currency } = useStudio();
  const staff = useQuery(queries.staff());
  const master = staff.data?.[0];
  // Three real services with different looks: the popular ones first, then the rest of the list.
  const offered = catalog.services.filter((s) => !/^(length|refill)-/.test(s.art));
  const arts = new Set<ServiceArt>();
  const services = [...offered.filter((s) => s.isPopular), ...offered.filter((s) => !s.isPopular)]
    .filter((s) => !arts.has(s.art) && Boolean(arts.add(s.art)))
    .slice(0, 3);
  const fallback: Array<{ art: ServiceArt; color: SwatchColor }> = [
    { art: 'gel', color: 'blush' },
    { art: 'french', color: 'peach' },
    { art: 'design-complex', color: 'lilac' },
  ];
  const cards = fallback.map((f, i) => {
    const service = services[i];
    const color = (service && catalog.categoryById.get(service.categoryId)?.color) || f.color;
    return {
      key: service?.id ?? f.art,
      art: service?.art ?? f.art,
      color,
      name: service ? pick(service.name) : null,
      price: service ? formatPrice(t, service.price, currency, service.priceFrom) : null,
    };
  });
  const tilt = ['-rotate-3 -translate-x-3', 'rotate-0 translate-x-2 scale-[1.04]', 'rotate-2 -translate-x-1'];

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex w-[17.5rem] flex-col gap-2.5">
        {cards.map((card, i) => (
          <div
            key={card.key}
            style={order(i)}
            className={cx(
              'stagger relative flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-4 shadow-card',
              tilt[i],
              i === 1 && 'z-10 ring-2 ring-ink-900 shadow-raised',
            )}
          >
            <span className={cx('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl', SWATCH[card.color].field)}>
              <NailArt art={card.art} color={card.color} className="w-11" />
            </span>
            <span className="min-w-0 flex-1">
              {card.name ? (
                <>
                  <span className="block truncate text-[0.9375rem] font-bold">{card.name}</span>
                  <span className="tabular block text-sm font-semibold text-rose-600">{card.price}</span>
                </>
              ) : (
                <span className="flex flex-col gap-1.5">
                  <span className="h-2.5 w-28 rounded-pill bg-ink-900/80" />
                  <span className="h-2 w-14 rounded-pill bg-rose-300" />
                </span>
              )}
            </span>
            {i === 1 ? (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-sm text-white">
                <CheckIcon fontSize="inherit" />
              </span>
            ) : null}
          </div>
        ))}
        {master ? (
          <Piece i={3} className="-left-4 -top-11">
            <span className="inline-flex items-center gap-2 rounded-pill bg-white py-1 pl-1 pr-3.5 text-sm font-semibold shadow-card">
              <Avatar name={master.name} color={master.color} size="sm" />
              {master.name}
            </span>
          </Piece>
        ) : null}
        <Piece i={4} className="-bottom-12 -right-3">
          <Chip icon={ScheduleIcon} tone="ink">
            {t('scene.time')}
          </Chip>
        </Piece>
      </div>
    </div>
  );
}

/** Visits: the booking ticket with a reminder, the calendar and changes around it. */
function VisitsScene() {
  const { t } = useTranslation('onboarding');
  const { locale } = useLocale();
  const pick = useI18nText();
  const catalog = useCatalog();
  const service = catalog.services.find((s) => s.isPopular && !/^(length|refill)-/.test(s.art)) ?? catalog.services[0];
  // Three days from now, in the reader's language (the clock is read once).
  const [soon] = useState(() => new Date(Date.now() + 3 * 86_400_000));
  const month = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: 'short' }).format(soon).replace('.', '');

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-[17rem]">
        <Piece i={0} className="static">
          <div className="rounded-2xl bg-ink-900 p-4 text-white shadow-raised">
            <div className="flex items-start gap-3">
              <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-white pb-1.5 pt-1 text-ink-900">
                <span className="text-[0.6875rem] font-semibold uppercase text-rose-600">{month}</span>
                <span className="tabular text-xl font-extrabold leading-none">{soon.getDate()}</span>
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block font-bold">{t('scene.time')}</span>
                <span className="block truncate text-sm text-white/70">{service ? pick(service.name) : ' '}</span>
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/10 px-3 py-1.5 text-xs font-semibold">
                <CalendarAddIcon fontSize="inherit" className="text-sm" />
                {t('scene.calendar')}
              </span>
            </div>
          </div>
        </Piece>
        <Piece i={1} className="-right-5 -top-12 rotate-3">
          <Chip icon={NotificationsIcon}>{t('scene.reminder')}</Chip>
        </Piece>
        <Piece i={2} className="-bottom-12 -left-4 -rotate-2">
          <Chip icon={EventIcon} tone="mint">
            {t('scene.calendar')}
          </Chip>
        </Piece>
        <Piece i={3} className="-bottom-[5.5rem] right-0 rotate-1">
          <Chip icon={ReplayIcon}>{t('scene.change')}</Chip>
        </Piece>
      </div>
    </div>
  );
}

/** Loyalty: the stamp card itself, three visits in, the discounts waiting. */
function LoyaltyScene({ rewards }: { rewards: LoyaltyReward[] }) {
  const { t } = useTranslation('onboarding');
  const status: LoyaltyStatus = {
    enabled: true,
    cycle: 8,
    rewards,
    visits: 3,
    stamps: 3,
    card: 1,
    nextReward: null,
    history: [],
  };
  const [first, second] = rewards;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-[18rem]">
        <Piece i={0} className="static">
          <div className="rounded-[1.75rem] bg-white p-4 shadow-raised">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <LoyaltyIcon fontSize="inherit" className="text-base text-rose-600" />
                {t('scene.card')}
              </span>
              <span className="text-sm font-semibold text-ink-500">{t('scene.stamps')}</span>
            </div>
            <StampCard status={status} />
          </div>
        </Piece>
        {first ? (
          <Piece i={1} className="-right-4 -top-5 rotate-6">
            <span className="tabular inline-flex rounded-pill bg-rose-500 px-3.5 py-1.5 text-base font-extrabold text-white shadow-float">
              −{first.percent}%
            </span>
          </Piece>
        ) : null}
        {second ? (
          <Piece i={2} className="-bottom-5 -left-4 -rotate-6">
            <span className="tabular inline-flex rounded-pill bg-ink-900 px-3.5 py-1.5 text-base font-extrabold text-white shadow-float">
              −{second.percent}%
            </span>
          </Piece>
        ) : null}
      </div>
    </div>
  );
}

/** Home Screen: a phone with the studio's icon among the other apps. */
function HomeScene() {
  const { t } = useTranslation('onboarding');
  const tones = ['bg-blush-200', 'bg-cyan-100', 'bg-peach-100', 'bg-mint-100', 'bg-lilac-100', 'bg-ink-100'];
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative">
        <Piece i={0} className="static">
          <div className="grid aspect-[9/16] h-[min(20rem,68vh)] grid-cols-4 content-start gap-x-3 gap-y-4 rounded-[2.25rem] bg-white/75 p-5 pt-8 shadow-raised ring-1 ring-inset ring-ink-900/5">
            {Array.from({ length: 16 }, (_, i) =>
              i === 5 ? (
                <span key={i} className="flex flex-col items-center gap-1">
                  <span className="flex aspect-square w-full items-center justify-center rounded-[0.7rem] bg-blush-100 shadow-card ring-2 ring-rose-400 animate-pop [animation-delay:420ms]">
                    <Logo variant="mark" className="w-[78%]" />
                  </span>
                </span>
              ) : (
                <span key={i} className={cx('aspect-square w-full rounded-[0.7rem]', tones[i % tones.length], i > 11 && 'opacity-60')} />
              ),
            )}
          </div>
        </Piece>
        <Piece i={2} className="-bottom-5 left-1/2 -translate-x-1/2">
          <Chip icon={AddBoxIcon} tone="ink">
            {t('scene.addHome')}
          </Chip>
        </Piece>
      </div>
    </div>
  );
}

/** Already installed: the app icon, checked, with what's inside. */
function ReadyScene() {
  const { t } = useTranslation('onboarding');
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative">
        <Piece i={0} className="static">
          <span className="relative flex size-32 items-center justify-center rounded-[2.2rem] bg-blush-100 shadow-raised">
            <Logo variant="mark" className="w-24" />
            <span className="absolute -right-2 -top-2 inline-flex size-10 items-center justify-center rounded-pill bg-mint-500 text-2xl text-white shadow-card animate-pop [animation-delay:380ms]">
              <CheckIcon fontSize="inherit" />
            </span>
          </span>
        </Piece>
        <Piece i={1} className="-left-24 -top-8 -rotate-3">
          <Chip icon={EventIcon}>{t('scene.time')}</Chip>
        </Piece>
        <Piece i={2} className="-bottom-10 -right-24 rotate-2">
          <Chip icon={LoyaltyIcon} tone="rose">
            {t('scene.card')}
          </Chip>
        </Piece>
      </div>
    </div>
  );
}
