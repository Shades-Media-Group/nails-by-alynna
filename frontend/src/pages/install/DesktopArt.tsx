import { Logo } from '@/components/brand/Logo';
import { ArrowBackIcon, ArrowForwardIcon, InstallDesktopIcon, LockIcon, MoreVertIcon, RefreshIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { HIGHLIGHT, highlightDelay } from './highlight';

/**
 * A computer browser's tab and address bar, drawn simply, with our mark on the install icon at
 * the right end of the address bar. Loaded only when the computer steps are shown.
 */
export default function DesktopArt({ alt }: { alt: string }) {
  return (
    <div role="img" aria-label={alt} className="size-full text-[3.6cqw] leading-tight text-ink-700">
      <div aria-hidden="true" className="flex size-full flex-col overflow-hidden bg-white">
        <div className="flex items-end bg-ink-100 px-[3%] pt-[0.7em]">
          <div className="flex w-[46%] items-center gap-[0.5em] rounded-t-[0.7em] bg-white px-[0.8em] py-[0.55em]">
            <Logo variant="mark" className="w-[1.4em]" />
            <span className="h-[0.5em] flex-1 rounded-pill bg-ink-200" />
          </div>
        </div>
        <div className="flex items-center gap-[0.55em] border-b border-ink-100 px-[3%] py-[0.55em] text-[1.05em]">
          <ArrowBackIcon fontSize="inherit" className="text-ink-500" />
          <ArrowForwardIcon fontSize="inherit" className="text-ink-300" />
          <RefreshIcon fontSize="inherit" className="text-ink-500" />
          <div className="flex h-[1.9em] flex-1 items-center gap-[0.45em] rounded-pill bg-ink-100 pl-[0.7em] pr-[0.2em]">
            <LockIcon fontSize="inherit" className="text-[0.85em] text-ink-500" />
            <span className="h-[0.45em] w-[42%] rounded-pill bg-ink-300" />
            <span
              className={cx('ml-auto grid size-[1.55em] place-items-center rounded-full bg-white text-ink-800', HIGHLIGHT)}
              style={highlightDelay(0)}
            >
              <InstallDesktopIcon fontSize="inherit" className="text-[0.9em]" />
            </span>
          </div>
          <MoreVertIcon fontSize="inherit" className="text-ink-500" />
        </div>
        <div className="flex flex-1 flex-col gap-[0.6em] px-[6%] pt-[5%]">
          <span className="h-[0.6em] w-[38%] rounded-pill bg-ink-200" />
          <span className="h-[0.6em] w-[56%] rounded-pill bg-ink-100" />
        </div>
      </div>
    </div>
  );
}
