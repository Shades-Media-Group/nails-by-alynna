import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';
import { lockScroll } from '@/lib/scroll-lock';
import { CloseIcon } from './icons';
import { IconButton } from './IconButton';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Visually hide the title (kept for screen readers). */
  hideTitle?: boolean;
  size?: 'md' | 'lg';
}

/**
 * Bottom sheet on phones, centred dialog from md up. Built on <dialog> + showModal(), so
 * focus trapping, Escape and inert background come from the platform.
 */
export function Sheet({ open, onClose, title, description, children, footer, hideTitle, size = 'md' }: SheetProps) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const releaseScroll = useRef<(() => void) | null>(null);
  const titleId = useId();
  const closing = useRef(false);

  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    // Slides back down (and the dim fades) before the dialog actually closes.
    dialog.dataset.state = 'closed';
    const done = () => {
      closing.current = false;
      // Reopened meanwhile? Then it stays.
      if (dialog.open && dialog.dataset.state === 'closed') dialog.close();
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) done();
    else window.setTimeout(done, 220);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) requestClose();
      return;
    }
    closing.current = false;
    if (!dialog.open) {
      dialog.dataset.state = 'closed';
      dialog.showModal();
      // Focus the sheet itself, without scrolling: iOS otherwise jumps to the first button.
      panel.current?.focus({ preventScroll: true });
    }
    // Held while open, also when React's development double-mount released it once.
    releaseScroll.current ??= lockScroll();
    if (dialog.dataset.state === 'open') return;
    // The panel is painted once at its start position (below the screen), then slides up: a
    // transition needs a frame drawn at the start value, or iOS jumps straight to the end.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        dialog.dataset.state = 'open';
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, requestClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onDialogClose = () => {
      releaseScroll.current?.();
      releaseScroll.current = null;
      if (open) onClose();
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener('close', onDialogClose);
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [open, onClose, requestClose]);

  useEffect(
    () => () => {
      releaseScroll.current?.();
      releaseScroll.current = null;
    },
    [],
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
      className={cx(
        // overflow-visible: a modal <dialog> clips its content (overflow: auto), which hid the
        // panel for its whole slide-up and made it pop in at the end. touch-none: a drag on the dim
        // or the sheet's header never scrolls the page behind (iOS before 26.4 ignores
        // overflow: hidden on the page).
        'group m-0 max-h-none w-full max-w-none touch-none overflow-visible bg-transparent p-0 text-ink-900',
        'fixed inset-x-0 bottom-0 top-auto md:inset-0 md:m-auto md:h-fit',
        size === 'lg' ? 'md:max-w-2xl' : 'md:max-w-lg',
        'open:flex',
      )}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-sheet outline-none',
          'rounded-t-2xl md:rounded-2xl',
          // Phones: slides up from below the screen. Wider screens: a short rise and fade.
          'translate-y-full transition-[translate,opacity] md:translate-y-2 md:opacity-0',
          'group-data-[state=open]:translate-y-0 group-data-[state=open]:opacity-100 group-data-[state=open]:duration-[380ms] group-data-[state=open]:ease-(--ease-out)',
          'group-data-[state=closed]:duration-200 group-data-[state=closed]:ease-(--ease-in-out)',
        )}
      >
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-pill bg-ink-200" />
        </div>
        <header className="flex items-start justify-between gap-4 px-6 pb-2 pt-4 md:pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className={cx('text-h3 font-bold', hideTitle && 'sr-only')}>
              {title}
            </h2>
            {description ? <div className="mt-1 text-sm text-ink-600">{description}</div> : null}
          </div>
          <IconButton icon={CloseIcon} label={t('actions.close')} variant="soft" size="sm" onClick={requestClose} />
        </header>
        <div data-sheet-body="" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-6 pb-6 pt-2">
          {children}
        </div>
        {footer ? (
          <footer className="border-t border-ink-100 bg-white px-6 pb-[max(1rem,var(--safe-bottom))] pt-4">{footer}</footer>
        ) : (
          <div className="pb-[var(--safe-bottom)]" />
        )}
      </div>
    </dialog>
  );
}
