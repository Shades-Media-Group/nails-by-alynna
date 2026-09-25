import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { QrCode } from '@/components/common/QrCode';
import { Button, Sheet, Skeleton, toast } from '@/components/ui';
import { ChatIcon, ContentCopyIcon, IosShareIcon, RefreshIcon, WhatsAppIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatDayLong } from '@/lib/format';
import { adminApi } from '../api';
import { smsHref, whatsappHref } from './utils';

// Share targets as tiles (icon over label): four fit side by side at phone width in every language.
const TILE =
  'press flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-2xl bg-blush-100 px-1 py-2.5 text-center text-xs font-semibold leading-tight text-ink-900 hover:bg-blush-200';

export interface InviteClient {
  id: string;
  name: string;
  surname: string;
  phone: string | null;
}

/**
 * The desk invite: a big QR code the client scans to create their own account on this record
 * (bookings included), plus the same link to send by WhatsApp, SMS or any app. Mount it only
 * while shown: each opening issues a fresh link and retires the previous one.
 */
export function InviteSheet({ client, onClose }: { client: InviteClient; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const invite = useQuery({
    queryKey: ['admin', 'invite', client.id],
    queryFn: () => adminApi.inviteClient(client.id),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const url = invite.data?.url ?? '';
  const message = t('invite.message', { name: client.name, url });
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('invite.copied'));
    } catch {
      toast.error(t('invite.copyFailed'));
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t('invite.shareTitle'), text: message });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error(t('common:errors.generic'));
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('invite.title', { name: client.name })}
      description={t('invite.text')}
      footer={
        <Button size="md" fullWidth onClick={onClose}>
          {t('invite.done')}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {invite.isPending ? (
          <>
            <Skeleton rounded="xl" className="aspect-square w-full max-w-64" />
            <Skeleton className="h-4 w-48" />
          </>
        ) : invite.isError ? (
          <div className="flex w-full flex-col items-start gap-3">
            <Alert className="w-full">{errorMessage(t, invite.error)}</Alert>
            <Button size="md" variant="soft" icon={RefreshIcon} onClick={() => void invite.refetch()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="w-full max-w-64 animate-rise rounded-2xl bg-white p-2 ring-1 ring-inset ring-ink-100">
              <QrCode value={url} label={t('invite.qrLabel', { name: client.name })} className="w-full" />
            </div>
            <p className="text-center text-sm text-ink-600">
              {t('invite.expires', { date: formatDayLong(invite.data.expiresAt, locale, timeZone) })}
            </p>
            <div className={cx('grid w-full gap-2', canShare ? 'grid-cols-4' : 'grid-cols-3')}>
              <button type="button" onClick={() => void copy()} className={TILE}>
                <ContentCopyIcon fontSize="inherit" className="text-2xl" />
                {t('invite.copy')}
              </button>
              {canShare ? (
                <button type="button" onClick={() => void share()} className={TILE}>
                  <IosShareIcon fontSize="inherit" className="text-2xl" />
                  {t('invite.share')}
                </button>
              ) : null}
              <a href={whatsappHref(message, client.phone)} target="_blank" rel="noopener noreferrer" className={TILE}>
                <WhatsAppIcon fontSize="inherit" className="text-2xl" />
                WhatsApp
              </a>
              <a href={smsHref(message, client.phone)} className={TILE}>
                <ChatIcon fontSize="inherit" className="text-2xl" />
                SMS
              </a>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
