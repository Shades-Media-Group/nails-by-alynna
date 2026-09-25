import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';
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
  const titleId = useId();
  const closing = useRef(false);

  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    dialog.dataset.closing = 'true';
    const done = () => {
      closing.current = false;
      delete dialog.dataset.closing;
      if (dialog.open) dialog.close();
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) done();
    else window.setTimeout(done, 200);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      requestClose();
    }
  }, [open, requestClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onDialogClose = () => {
      document.documentElement.style.overflow = '';
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

  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
      className={cx(
        'group m-0 max-h-none w-full max-w-none bg-transparent p-0 text-ink-900 backdrop:transition-opacity',
        'fixed inset-x-0 bottom-0 top-auto md:inset-0 md:m-auto md:h-fit',
        size === 'lg' ? 'md:max-w-2xl' : 'md:max-w-lg',
        'open:flex',
      )}
    >
      <div
        className={cx(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-sheet',
          'rounded-t-2xl md:rounded-2xl',
          'animate-sheet-in md:animate-rise',
          'group-data-[closing=true]:translate-y-full group-data-[closing=true]:transition-transform group-data-[closing=true]:duration-200',
          'md:group-data-[closing=true]:translate-y-2 md:group-data-[closing=true]:opacity-0 md:group-data-[closing=true]:transition-[opacity,transform]',
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-2">{children}</div>
        {footer ? (
          <footer className="border-t border-ink-100 bg-white px-6 pb-[max(1rem,var(--safe-bottom))] pt-4">{footer}</footer>
        ) : (
          <div className="pb-[var(--safe-bottom)]" />
        )}
      </div>
    </dialog>
  );
}
