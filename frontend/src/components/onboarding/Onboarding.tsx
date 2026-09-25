import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/Logo';
import { NailArt } from '@/components/brand/NailArt';
import { Button } from '@/components/ui';
import { CalendarAddIcon, CheckIcon, NotificationsIcon, ScheduleIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { LOCALE_TAGS } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { ordinal } from '@/lib/ordinal';
import { isStandalone } from '@/lib/platform';
import { lockScroll } from '@/lib/scroll-lock';
import { session, storage } from '@/lib/storage';
import { queries } from '@/services/queries';
import type { ServiceArt } from '@/types/api';

type SlideKey = 'book' | 'visits' | 'loyalty' | 'home' | 'ready';

const keyFor = (userId: string) => `nba:onboarded:${userId}`;

/**
 * First-run intro for a new client: four short screens with a segmented progress bar, Skip in
 * the corner and one Continue button (swipe works too). Shown once per account on this device;
 * a shared demo account sees it once per visit.
 */
export function Onboarding({ userId, demo }: { userId: string; demo: boolean }) {
  const store = demo ? session : storage;
  const [open, setOpen] = useState(() => store.get(keyFor(userId)) === null);
  if (!open) return null;
  return (
    <OnboardingDialog
      onDone={() => {
        store.set(keyFor(userId), new Date().toISOString());
        setOpen(false);
      }}
    />
  );
}

function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation(['onboarding', 'loyalty']);
  const { locale } = useLocale();
  const { data: config } = useStudio();
  const catalog = useQuery(queries.catalog());
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

  // The studio's own popular looks (finishes and designs; the length guides read as diagrams).
  const popular = (catalog.data?.services ?? [])
    .filter((s) => s.isPopular && !/^(length|refill)-/.test(s.art))
    .slice(0, 3);

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
      className="fixed inset-0 z-[60] flex flex-col bg-white pb-[var(--safe-bottom)] pt-[var(--safe-top)] outline-none animate-fade-in"
    >
      <div className="gutter-x mx-auto flex w-full max-w-lg items-center gap-4 pt-3">
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {slides.map((key, i) => (
            <span key={key} className="h-1 flex-1 overflow-hidden rounded-pill bg-ink-100">
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
          className="press -mr-2 shrink-0 rounded-pill px-3 py-2 text-sm font-semibold text-ink-600 hover:bg-ink-50 hover:text-ink-900"
        >
          {t('skip')}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {t('step', { current: index + 1, total: slides.length })}
      </p>

      <div className="gutter-x mx-auto flex w-full max-w-lg flex-1 flex-col justify-center overflow-hidden">
        <div
          key={slide}
          className={cx(
            'flex flex-col',
            direction > 0 ? 'animate-[slide-in-right_420ms_var(--ease-out)_backwards]' : 'animate-[slide-in-left_420ms_var(--ease-out)_backwards]',
          )}
        >
          <Illustration slide={slide} popular={popular.map((s) => s.art)} rewards={loyalty?.rewards ?? []} />
          <h2 id={titleId} className="mt-10 text-[2rem] font-extrabold leading-[1.05] tracking-[-0.035em]">
            {t(`${slide}.title`)}
          </h2>
          <p className="mt-3 text-[1.0625rem] leading-relaxed text-ink-600">{t(`${slide}.text`)}</p>
          {slide === 'loyalty' && loyalty ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {loyalty.rewards.map((reward) => (
                <li key={reward.visit} className="rounded-pill bg-rose-50 px-3.5 py-1.5 text-[0.9375rem] font-semibold text-rose-700 first-letter:uppercase">
                  {ordinal(reward.visit, locale)} {t('visit')} · −{reward.percent}%
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="gutter-x mx-auto w-full max-w-lg pb-4 pt-2">
        <Button fullWidth size="lg" onClick={() => go(index + 1)}>
          {last ? t('start') : t('next')}
        </Button>
      </div>
    </div>
  );
}

/** Each screen's picture, drawn from the brand's own nail art (no stock imagery). */
function Illustration({
  slide,
  popular,
  rewards,
}: {
  slide: SlideKey;
  popular: ServiceArt[];
  rewards: Array<{ visit: number; percent: number }>;
}) {
  const { locale } = useLocale();
  // A booking three days from now, in the reader's language (the clock is read once).
  const [soon] = useState(() => new Date(Date.now() + 3 * 86_400_000));
  const frame = (children: ReactNode, tone: string) => (
    <div className={cx('relative flex h-[min(38dvh,18rem)] items-center justify-center overflow-hidden rounded-[2rem]', tone)}>{children}</div>
  );
  if (slide === 'book') {
    const arts: ServiceArt[] = popular.length >= 3 ? popular : ['gel', 'french', 'design-complex'];
    return frame(
      <div className="flex items-end gap-3">
        <NailArt art={arts[0]!} color="blush" className="w-24 -rotate-12" />
        <NailArt art={arts[1]!} color="peach" className="w-28 -translate-y-4" shine />
        <NailArt art={arts[2]!} color="lilac" className="w-24 rotate-12" />
      </div>,
      'bg-blush-100',
    );
  }
  if (slide === 'visits') {
    const month = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: 'short' }).format(soon).replace('.', '');
    return frame(
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-card">
          <span className="flex w-12 flex-col items-center rounded-xl bg-blush-100 pb-1 pt-0.5">
            <span className="text-[0.6875rem] font-semibold uppercase text-rose-600">{month}</span>
            <span className="tabular text-xl font-extrabold leading-none">{soon.getDate()}</span>
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="h-2.5 w-28 rounded-pill bg-ink-900" />
            <span className="h-2 w-20 rounded-pill bg-ink-200" />
          </span>
        </div>
        <div className="flex gap-2">
          {[NotificationsIcon, CalendarAddIcon, ScheduleIcon].map((Icon, i) => (
            <span key={i} className="inline-flex size-11 items-center justify-center rounded-pill bg-white text-xl text-ink-800 shadow-card">
              <Icon fontSize="inherit" />
            </span>
          ))}
        </div>
      </div>,
      'bg-cyan-50',
    );
  }
  if (slide === 'loyalty') {
    return frame(
      <div className="grid grid-cols-4 gap-2.5">
        {Array.from({ length: 8 }, (_, i) => {
          const percent = rewards.find((r) => r.visit === i + 1)?.percent;
          return (
            <span
              key={i}
              className={cx(
                'tabular flex size-12 items-center justify-center rounded-pill text-xs font-extrabold',
                i < 3 ? 'bg-rose-500 text-white' : percent ? 'border-2 border-dashed border-rose-300 bg-white text-rose-600' : 'bg-white/80 text-sm text-ink-400',
              )}
            >
              {i < 3 ? <CheckIcon fontSize="inherit" className="text-xl" /> : percent ? `−${percent}%` : i + 1}
            </span>
          );
        })}
      </div>,
      'bg-peach-50',
    );
  }
  return frame(
    <div className="flex flex-col items-center gap-3">
      <span className="flex size-24 items-center justify-center rounded-[1.6rem] bg-blush-100 shadow-raised">
        <Logo variant="mark" className="w-16" />
      </span>
      <span className="h-2 w-16 rounded-pill bg-ink-200" />
    </div>,
    'bg-mint-50',
  );
}
