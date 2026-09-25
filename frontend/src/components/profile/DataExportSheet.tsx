import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Sheet, Spinner, toast } from '@/components/ui';
import { DownloadIcon } from '@/components/ui/icons';

/** The export as a file, fetched with the session cookie (never by navigating to it). */
async function fetchExport(): Promise<File> {
  const response = await fetch('/api/me/export', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const date = new Date().toISOString().slice(0, 10);
  return new File([blob], `nails-by-alynna-my-data-${date}.json`, { type: 'application/json' });
}

/**
 * "Download my data" (GDPR / Law 133 right of access). The file is prepared first, then saved
 * with a tap: phones get the share sheet (Save to Files, Mail, …), computers a normal download.
 * Opening the export URL directly would leave the installed iPhone app stuck on a file preview.
 */
export function DataExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['account', 'common']);
  const file = useQuery({ queryKey: ['me', 'export'], queryFn: fetchExport, enabled: open, staleTime: 0, gcTime: 0, retry: false });

  const save = async () => {
    const data = file.data;
    if (!data) return;
    // The share sheet needs the tap that is happening right now: the file is already in memory.
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [data] })) {
      try {
        await navigator.share({ files: [data] });
        onClose();
        return;
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        // Fall back to a download below.
      }
    }
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = data.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t('profile.exportSaved'));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('profile.export')} description={t('profile.exportText')}>
      <div className="flex flex-col gap-4 py-2">
        {file.isPending ? (
          <p className="flex items-center gap-3 text-[0.9375rem] text-ink-700" role="status">
            <Spinner className="size-5" />
            {t('profile.exportPreparing')}
          </p>
        ) : file.isError ? (
          <Alert>{t('common:errors.generic')}</Alert>
        ) : (
          <>
            <p className="text-[0.9375rem] text-ink-700">{t('profile.exportReady')}</p>
            <Button icon={DownloadIcon} fullWidth onClick={() => void save()}>
              {t('profile.exportSave')}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
