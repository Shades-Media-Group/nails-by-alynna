import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/brand/Logo';
import {
  AddToHomeScreenIcon,
  ChevronRightIcon,
  DownloadIcon,
  LanguageIcon,
  LockIcon,
  MoreVertIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { HIGHLIGHT, highlightDelay } from './highlight';

interface Labels {
  menuItem: string;
  install: string;
  shortcut: string;
  shortcutNote: string;
  cancel: string;
}

/**
 * Chrome on Android, drawn (there is no Android device to screenshot): simplified, generic
 * scenes of each step with the button's real label in the visitor's language and our mark on
 * it. Loaded only when the Android steps are shown.
 */
export default function AndroidArt({ step, alt }: { step: number; alt: string }) {
  const { t } = useTranslation('install');
  const labels = t('androidLabels', { returnObjects: true }) as Labels;
  const scene = [<MenuScene key="menu" labels={labels} />, <SheetScene key="sheet" labels={labels} />, <DialogScene key="dialog" labels={labels} />, <HomeScene key="home" />][step];
  return (
    <div role="img" aria-label={alt} className="size-full text-[3.4cqw] leading-tight text-ink-900">
      <div aria-hidden="true" className="relative size-full overflow-hidden">
        {scene}
      </div>
    </div>
  );
}

const mark = (step: number): { className: string; style: CSSProperties } => ({ className: HIGHLIGHT, style: highlightDelay(step) });

/** Grey bars standing in for a web page. */
function PageLines({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-[0.7em] px-[5%] pt-[5%]', className)}>
      <span className="h-[3.2em] w-full rounded-[0.8em] bg-blush-100" />
      <span className="h-[0.55em] w-[70%] rounded-pill bg-ink-200" />
      <span className="h-[0.55em] w-[55%] rounded-pill bg-ink-200" />
      <span className="h-[0.55em] w-[62%] rounded-pill bg-ink-200" />
    </div>
  );
}

/** A plain menu row: icon and text as grey shapes. */
function MenuLine({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-[0.7em] px-[0.7em] py-[0.6em]">
      <span className="size-[1.1em] shrink-0 rounded-[0.3em] bg-ink-200" />
      <span className="h-[0.5em] rounded-pill bg-ink-200" style={{ width }} />
    </div>
  );
}

function AppIcon({ className }: { className?: string }) {
  return (
    <span className={cx('grid aspect-square place-items-center rounded-[28%] bg-blush-100', className)}>
      <Logo variant="mark" className="w-[74%]" />
    </span>
  );
}

function MenuScene({ labels }: { labels: Labels }) {
  const dots = mark(0);
  const item = mark(0);
  return (
    <div className="size-full bg-white">
      <div className="flex items-center gap-[0.6em] border-b border-ink-100 px-[3%] py-[0.55em]">
        <div className="flex h-[2.1em] flex-1 items-center gap-[0.5em] rounded-pill bg-ink-100 px-[0.8em]">
          <LockIcon fontSize="inherit" className="text-[1em] text-ink-500" />
          <span className="h-[0.5em] w-[45%] rounded-pill bg-ink-300" />
        </div>
        <span className="grid size-[1.5em] place-items-center rounded-[0.35em] ring-2 ring-inset ring-ink-400 text-[0.8em] font-bold text-ink-600">
          3
        </span>
        <span className={cx('grid size-[2.1em] shrink-0 place-items-center rounded-full text-[1.1em] text-ink-800', dots.className)} style={dots.style}>
          <MoreVertIcon fontSize="inherit" />
        </span>
      </div>
      <PageLines className="w-[40%]" />
      <div className="absolute right-[3%] top-[22%] w-[62%] rounded-[0.9em] bg-white p-[0.35em] shadow-raised ring-1 ring-ink-100">
        <MenuLine width="58%" />
        <MenuLine width="44%" />
        <div className={cx('my-[0.2em] flex items-center gap-[0.6em] rounded-[0.6em] bg-blush-50 px-[0.6em] py-[0.55em] font-semibold', item.className)} style={item.style}>
          <AddToHomeScreenIcon fontSize="inherit" className="shrink-0 text-[1.3em] text-rose-600" />
          <span>{labels.menuItem}</span>
        </div>
        <MenuLine width="50%" />
        <MenuLine width="36%" />
      </div>
    </div>
  );
}

function Option({ icon: Icon, title, note, marked }: { icon: IconComponent; title: string; note?: string; marked?: boolean }) {
  const m = mark(1);
  return (
    <div className={cx('flex items-center gap-[0.8em] rounded-[0.8em] px-[0.6em] py-[0.5em]', marked && m.className)} style={marked ? m.style : undefined}>
      <span className="grid size-[2.2em] shrink-0 place-items-center rounded-full bg-blush-100 text-[1.1em] text-rose-700">
        <Icon fontSize="inherit" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {note ? <span className="mt-[0.15em] block text-[0.85em] text-ink-600">{note}</span> : null}
      </span>
      <ChevronRightIcon fontSize="inherit" className="shrink-0 text-[1.3em] text-ink-400" />
    </div>
  );
}

function Dimmed({ children }: { children: ReactNode }) {
  return (
    <div className="size-full bg-white">
      <PageLines />
      <div className="absolute inset-0 bg-ink-900/30" />
      {children}
    </div>
  );
}

function SheetScene({ labels }: { labels: Labels }) {
  return (
    <Dimmed>
      <div className="absolute inset-x-0 bottom-0 rounded-t-[1.3em] bg-white px-[5%] pb-[4%] pt-[0.6em] shadow-sheet">
        <span className="mx-auto mb-[0.7em] block h-[0.3em] w-[2.6em] rounded-pill bg-ink-200" />
        <p className="mb-[0.6em] px-[0.6em] font-bold">{labels.menuItem}</p>
        <Option icon={DownloadIcon} title={labels.install} marked />
        <Option icon={LanguageIcon} title={labels.shortcut} note={labels.shortcutNote} />
      </div>
    </Dimmed>
  );
}

function DialogScene({ labels }: { labels: Labels }) {
  const m = mark(2);
  return (
    <Dimmed>
      <div className="absolute left-1/2 top-1/2 w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[1.3em] bg-white p-[5%] shadow-raised">
        <div className="flex items-center gap-[0.8em]">
          <AppIcon className="w-[3em] shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-bold">Nails by Alynna</p>
            <span className="mt-[0.45em] block h-[0.5em] w-[6.5em] rounded-pill bg-ink-200" />
          </div>
        </div>
        <div className="mt-[1.3em] flex items-center justify-end gap-[0.6em] font-semibold">
          <span className="px-[0.6em] py-[0.5em] text-ink-600">{labels.cancel}</span>
          <span className={cx('rounded-pill bg-ink-900 px-[1.1em] py-[0.5em] text-white', m.className)} style={m.style}>
            {labels.install}
          </span>
        </div>
      </div>
    </Dimmed>
  );
}

function HomeScene() {
  const m = mark(3);
  return (
    <div className="grid size-full grid-cols-4 content-start gap-x-[7%] gap-y-[0.8em] bg-linear-to-b from-cyan-50 to-blush-100 px-[9%] pt-[6%]">
      {Array.from({ length: 8 }, (_, i) =>
        i === 5 ? (
          <div key={i} className="min-w-0">
            <span className={cx('block rounded-[28%]', m.className)} style={m.style}>
              <AppIcon className="w-full" />
            </span>
            <span className="mt-[0.35em] block truncate text-center text-[0.72em] font-medium">Nails by Alynna</span>
          </div>
        ) : (
          <div key={i}>
            <span className="block aspect-square rounded-[28%] bg-white/75" />
            <span className="mx-auto mt-[0.55em] block h-[0.45em] w-[70%] rounded-pill bg-white/80" />
          </div>
        ),
      )}
    </div>
  );
}
