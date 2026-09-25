import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Button, Skeleton, TextField } from '@/components/ui';
import { KeyboardIcon, QrCodeScannerIcon } from '@/components/ui/icons';
import { isApiError } from '@/services/api/client';
import { errorMessage } from '@/lib/errors';
import { normalizeMemberCode } from '@/lib/member-code';
import { AdminHeader } from '../components/AdminHeader';
import { adminLoyaltyQueries } from '../loyalty/api';
import { CardPanel } from '../loyalty/CardPanel';
import { QrScanner } from '../loyalty/QrScanner';

/**
 * /admin/scan — the desk: scan the QR in the client's app (or type the code) to open their
 * loyalty card, see the discount on today's visit and stamp it. The code lives in the URL, so
 * a phone camera scan of the QR (…/c/CODE) lands here too.
 */
export default function ScanPage() {
  const { t } = useTranslation(['loyalty', 'common']);
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | undefined>();
  const code = normalizeMemberCode(params.get('code') ?? '');
  const card = useQuery({ ...adminLoyaltyQueries.card(code ?? ''), enabled: Boolean(code) });

  const open = (value: string) => {
    const normalized = normalizeMemberCode(value);
    if (!normalized) {
      setTypedError(t('scan.invalid'));
      return;
    }
    setTypedError(undefined);
    setParams({ code: normalized });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    open(typed);
  };
  const again = () => {
    setTyped('');
    setParams({});
  };

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('scan.title')}
        subtitle={code ? undefined : t('scan.subtitle')}
        actions={
          code ? (
            <Button size="sm" variant="outline" icon={QrCodeScannerIcon} onClick={again}>
              {t('scan.again')}
            </Button>
          ) : null
        }
      />
      <div className="gutter-x mx-auto mt-6 w-full max-w-xl lg:px-0">
        {code ? (
          card.isPending ? (
            <div className="flex flex-col gap-4">
              <Skeleton rounded="xl" className="h-20" />
              <Skeleton rounded="xl" className="h-56" />
            </div>
          ) : card.isError ? (
            <Alert>{isApiError(card.error, 'CARD_NOT_FOUND') ? t('scan.notFound') : errorMessage(t, card.error)}</Alert>
          ) : (
            <CardPanel data={card.data} />
          )
        ) : (
          <div className="flex flex-col gap-6">
            <QrScanner onCode={open} />
            <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
              <p className="flex items-center gap-2 font-semibold">
                <KeyboardIcon fontSize="inherit" className="text-xl text-ink-500" />
                {t('scan.type')}
              </p>
              <TextField
                label={t('scan.codeLabel')}
                placeholder={t('scan.codePlaceholder')}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                error={typedError}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
              />
              <Button type="submit" size="md">
                {t('scan.open')}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
