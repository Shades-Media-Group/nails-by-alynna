import { Suspense, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui';
import { i18n } from '@/i18n';
import { cx } from '@/lib/cx';
import { LegalContent, type LegalDoc } from './LegalContent';

/**
 * "Terms" / "Privacy" inside a sentence (sign-up, Google consent line). Opens the text in a
 * sheet over the form: nothing typed is lost, and the installed app never opens a browser tab.
 * The sheet is portalled out, so taps in it never reach a surrounding checkbox label, and the
 * legal texts only download when first asked for.
 */
export function LegalLink({ doc, children, className }: { doc: LegalDoc; children?: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onPointerDown={() => void i18n.loadNamespaces('legal')}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMounted(true);
          setOpen(true);
        }}
        className={cx('cursor-pointer whitespace-nowrap underline underline-offset-2', className)}
      >
        {children}
      </button>
      {mounted
        ? createPortal(
            <Suspense fallback={null}>
              <LegalSheet doc={doc} open={open} onClose={() => setOpen(false)} />
            </Suspense>,
            document.body,
          )
        : null}
    </>
  );
}

function LegalSheet({ doc, open, onClose }: { doc: LegalDoc; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('legal');
  return (
    <Sheet open={open} onClose={onClose} title={t(`${doc}.title`)} size="lg">
      <LegalContent doc={doc} inSheet />
    </Sheet>
  );
}
