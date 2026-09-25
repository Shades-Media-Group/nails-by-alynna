import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Avatar, Badge, Button, SegmentedControl, Skeleton } from '@/components/ui';
import { PersonAddIcon } from '@/components/ui/icons';
import { errorMessage } from '@/lib/errors';
import { formatPhone, fullName } from '@/lib/format';
import { adminQueries } from '../api';
import { ClientFields } from './ClientFields';
import { useDebouncedValue } from './hooks';
import { SearchField } from './SearchField';
import { clientFieldIssues, clientFromSearch, type ClientFieldValues } from './utils';

export interface ExistingClient {
  kind: 'existing';
  id: string;
  name: string;
  surname: string;
  phone: string | null;
  email: string | null;
  hasAccount: boolean;
  bookingBlocked: boolean;
}
export interface NewClient extends ClientFieldValues {
  kind: 'new';
}
export type PickedClient = ExistingClient | NewClient;

/**
 * Who the booking is for: find a client by name, phone or email, or add a walk-in on the spot
 * (name, surname and phone; the email is optional, a QR invite covers the rest).
 */
export function ClientPicker({
  value,
  onChange,
  showErrors,
}: {
  value: PickedClient | null;
  onChange: (value: PickedClient | null) => void;
  showErrors: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const [mode, setMode] = useState<'existing' | 'new'>(value?.kind === 'new' ? 'new' : 'existing');
  const [term, setTerm] = useState('');
  const q = useDebouncedValue(term.trim(), 250);
  const results = useQuery({ ...adminQueries.clients({ q: q || undefined, page: 1, limit: 8 }), enabled: mode === 'existing' && value?.kind !== 'existing' });

  if (value?.kind === 'existing') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-inset ring-ink-100 animate-rise">
        <Avatar name={value.name} surname={value.surname} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-bold">{fullName(value)}</p>
          <p className="text-sm text-ink-600">{[formatPhone(value.phone), value.email].filter(Boolean).join(' · ') || t('client.noContact')}</p>
          {value.bookingBlocked ? <Badge tone="red" className="mt-1">{t('clients.blocked')}</Badge> : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => onChange(null)}>
          {t('booking.changeClient')}
        </Button>
      </div>
    );
  }

  const newValues: ClientFieldValues = value?.kind === 'new' ? value : { name: '', surname: '', phone: '', email: '' };
  const issues = showErrors ? clientFieldIssues(newValues) : {};
  const errors = Object.fromEntries(Object.entries(issues).map(([key, code]) => [key, t(`common:validation.${code}`)]));

  const startNew = (values: ClientFieldValues) => {
    setMode('new');
    onChange({ kind: 'new', ...values });
  };

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={t('booking.client')}
        value={mode}
        onChange={(next) => {
          if (next === 'new') {
            startNew(newValues);
          } else {
            setMode('existing');
            onChange(null);
          }
        }}
        options={[
          { value: 'existing', label: t('booking.existingClient') },
          { value: 'new', label: t('booking.newClient') },
        ]}
        className="w-full sm:w-auto"
      />

      {mode === 'new' ? (
        <ClientFields values={newValues} onChange={(values) => onChange({ kind: 'new', ...values })} errors={errors} emailHint={t('booking.emailHint')} />
      ) : (
        <>
          <SearchField label={t('booking.searchClient')} value={term} onChange={setTerm} />
          {showErrors ? <p className="text-sm font-semibold text-red-700">{t('booking.pickClient')}</p> : null}
          {results.isPending ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} rounded="xl" className="h-16" />
              ))}
            </div>
          ) : results.isError ? (
            <Alert>{errorMessage(t, results.error)}</Alert>
          ) : results.data.clients.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-ink-50 p-4">
              <p className="text-sm text-ink-700">{q ? t('booking.noClientMatch', { q }) : t('booking.noClientsYet')}</p>
              <Button size="sm" variant="outline" icon={PersonAddIcon} onClick={() => startNew(clientFromSearch(q))}>
                {t('booking.addAsNew')}
              </Button>
            </div>
          ) : (
            <div>
              <p className="mb-1.5 px-1 text-sm font-semibold text-ink-600">{q ? t('booking.matches') : t('booking.recentClients')}</p>
              <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100" aria-busy={results.isPlaceholderData || undefined}>
                {results.data.clients.map((client) => (
                  <li key={client.id}>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          kind: 'existing',
                          id: client.id,
                          name: client.name,
                          surname: client.surname,
                          phone: client.phone,
                          email: client.email,
                          hasAccount: client.hasAccount,
                          bookingBlocked: client.bookingBlocked,
                        })
                      }
                      className="press flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-ink-50"
                    >
                      <Avatar name={client.name} surname={client.surname} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold">{fullName(client)}</span>
                        <span className="block text-sm text-ink-600">
                          {[formatPhone(client.phone), client.email].filter(Boolean).join(' · ') || t('client.noContact')}
                        </span>
                      </span>
                      {client.hasAccount ? <Badge tone="mint">{t('clients.inApp')}</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
