import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, Sheet, Textarea, toast } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { adminApi, type ClientSummary } from '../api';
import { ClientFields } from './ClientFields';
import { clientFieldIssues, type ClientFieldValues } from './utils';

/** Add a client by hand (a call, a walk-in): name, surname and phone; email and notes optional. */
export function NewClientSheet({
  initial,
  onClose,
  onCreated,
}: {
  initial?: Partial<ClientFieldValues>;
  onClose: () => void;
  onCreated: (client: ClientSummary) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ClientFieldValues>({ name: '', surname: '', phone: '', email: '', ...initial });
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      adminApi.createClient({
        name: values.name.trim(),
        surname: values.surname.trim(),
        phone: values.phone.trim(),
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'clients'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
      toast.success(t('clients.added', { name: client.name }));
      onCreated(client);
    },
  });

  const issues = touched ? clientFieldIssues(values) : {};
  const server = fieldErrors(t, save.error);
  const errors = {
    ...server,
    ...Object.fromEntries(Object.entries(issues).map(([key, code]) => [key, t(`common:validation.${code}`)])),
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(clientFieldIssues(values)).length > 0) return;
    save.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('clients.new')}
      description={t('clients.newHint')}
      footer={
        <Button type="submit" form="new-client-form" size="md" loading={save.isPending} className="min-w-32">
          {t('clients.create')}
        </Button>
      }
    >
      <form id="new-client-form" className="flex flex-col gap-4 py-2" onSubmit={submit} noValidate>
        <ClientFields values={values} onChange={setValues} errors={errors} emailHint={t('booking.emailHint')} />
        <Textarea
          label={`${t('client.notes')} (${t('common.optional')})`}
          hint={t('client.notesHint')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
        />
        {save.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
      </form>
    </Sheet>
  );
}
