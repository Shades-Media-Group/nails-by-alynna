import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Sheet } from '@/components/ui';
import { errorMessage } from '@/lib/errors';

/** "Are you sure?" as a sheet: what happens, a way back, and the action in its true colour. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="soft" size="md" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={tone} size="md" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {children || error ? (
        <div className="flex flex-col gap-3 py-2">
          {children}
          {error ? <Alert>{errorMessage(t, error)}</Alert> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
