import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Badge, Button, ButtonLink, EmptyState, ListGroup, ListRow, Skeleton, Switch, Textarea, toast } from '@/components/ui';
import { CalendarAddIcon, CallIcon, EmailIcon, PersonOutlineIcon, QrCodeIcon, WhatsAppIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { formatPhone, formatPrice, fullName } from '@/lib/format';
import { isApiError } from '@/services/api/client';
import { adminApi, adminQueries, type ClientDetail, type ClientPatch } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { AppointmentRow } from '../components/AppointmentRow';
import { ClientFields } from '../components/ClientFields';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useNow } from '../components/hooks';
import { InviteSheet } from '../components/InviteSheet';
import { clientFieldIssues, telHref, whatsappHref, type ClientFieldValues } from '../components/utils';
import { ClientLoyalty } from '../loyalty/ClientLoyalty';

const HISTORY_STEP = 15;

/** One client: how to reach them, their visits, the studio's notes, and booking or inviting them. */
export default function ClientPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation(['admin', 'common']);
  const { lp, tag } = useLocale();
  const { timeZone } = useStudio();
  const detail = useQuery(adminQueries.client(id));
  const [inviting, setInviting] = useState(false);

  if (detail.isPending) {
    return (
      <div className="pb-8">
        <AdminHeader title={t('client.title')} backTo={lp('/admin/clients')} />
        <div className="gutter-x mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-0">
          <div className="flex flex-col gap-4">
            <Skeleton rounded="xl" className="h-36" />
            <Skeleton rounded="xl" className="h-48" />
          </div>
          <Skeleton rounded="xl" className="h-80" />
        </div>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="pb-8">
        <AdminHeader title={t('client.title')} backTo={lp('/admin/clients')} />
        {isApiError(detail.error, 'NOT_FOUND') ? (
          <EmptyState
            icon={PersonOutlineIcon}
            tone="peach"
            title={t('client.notFound')}
            action={
              <ButtonLink to={lp('/admin/clients')} size="md" variant="soft">
                {t('client.toClients')}
              </ButtonLink>
            }
          />
        ) : (
          <div className="gutter-x mt-6 lg:px-0">
            <Alert>{errorMessage(t, detail.error)}</Alert>
          </div>
        )}
      </div>
    );
  }

  const { client } = detail.data;
  const since = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone }).format(new Date(client.createdAt));

  return (
    <div className="pb-8">
      <AdminHeader
        title={fullName(client)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{t('client.since', { date: since })}</span>
            {client.hasAccount ? <Badge tone="mint">{t('clients.inApp')}</Badge> : <Badge tone="neutral">{t('clients.walkIn')}</Badge>}
            {client.bookingBlocked ? <Badge tone="red">{t('clients.blocked')}</Badge> : null}
          </span>
        }
        backTo={lp('/admin/clients')}
        backInHistory
        actions={
          <ButtonLink to={`${lp('/admin/appointments/new')}?clientId=${client.id}`} size="sm" icon={CalendarAddIcon}>
            {t('client.book')}
          </ButtonLink>
        }
      />

      <div className="gutter-x mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-0">
        <div className="flex min-w-0 flex-col gap-6">
          <Contact detail={detail.data} />

          {!client.hasAccount && client.isActive ? (
            <section aria-labelledby="invite-title" className="flex flex-col gap-3 rounded-2xl bg-blush-100 p-4 sm:flex-row sm:items-center">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-white text-2xl text-rose-700">
                <QrCodeIcon fontSize="inherit" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="invite-title" className="font-bold">
                  {t('invite.notInApp')}
                </h2>
                <p className="text-sm text-ink-700">{t('invite.clientText')}</p>
              </div>
              <Button size="md" onClick={() => setInviting(true)}>
                {t('invite.button')}
              </Button>
            </section>
          ) : null}

          <Visits detail={detail.data} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <ClientLoyalty clientId={client.id} />
          <Stats detail={detail.data} />
          <DetailsForm key={client.id} detail={detail.data} />
          <BookingAccess detail={detail.data} />
        </div>
      </div>

      {inviting ? <InviteSheet client={client} onClose={() => setInviting(false)} /> : null}
    </div>
  );
}

function Contact({ detail }: { detail: ClientDetail }) {
  const { t } = useTranslation('admin');
  const { client } = detail;
  if (!client.phone && !client.email) {
    return <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">{t('client.noContactText')}</p>;
  }
  return (
    <ListGroup title={t('client.contact')}>
      {client.phone ? (
        <>
          <ListRow icon={CallIcon} label={<span className="tabular">{formatPhone(client.phone)}</span>} description={t('client.call')} href={telHref(client.phone)} />
          <ListRow icon={WhatsAppIcon} label="WhatsApp" description={t('client.whatsappText')} href={whatsappHref('', client.phone)} external />
        </>
      ) : null}
      {client.email ? <ListRow icon={EmailIcon} label={<span className="break-words">{client.email}</span>} description={t('client.email')} href={`mailto:${client.email}`} /> : null}
    </ListGroup>
  );
}

function Stats({ detail }: { detail: ClientDetail }) {
  const { t } = useTranslation(['admin', 'common']);
  const { currency } = useStudio();
  const cells: Array<[string, string | number, boolean?]> = [
    [t('client.stats.visits'), detail.stats.visits],
    [t('client.stats.noShows'), detail.stats.noShows, detail.stats.noShows > 0],
    [t('client.stats.cancelled'), detail.stats.cancelled],
    [t('client.stats.spent'), formatPrice(t, detail.stats.spent, currency)],
  ];
  return (
    <section aria-labelledby="stats-title">
      <h2 id="stats-title" className="sr-only">
        {t('client.stats.title')}
      </h2>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink-100 ring-1 ring-inset ring-ink-100">
        {cells.map(([label, value, alarm]) => (
          <div key={label} className="bg-white p-4">
            <dt className="text-sm text-ink-600">{label}</dt>
            <dd className={alarm ? 'tabular mt-1 text-h2 font-extrabold text-red-700' : 'tabular mt-1 text-h2 font-extrabold'}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Visits({ detail }: { detail: ClientDetail }) {
  const { t } = useTranslation('admin');
  const { lp } = useLocale();
  const now = useNow();
  const [shown, setShown] = useState(HISTORY_STEP);
  const upcoming = detail.appointments
    .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.end).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  const past = detail.appointments.filter((a) => !upcoming.includes(a));

  return (
    <>
      <section aria-labelledby="upcoming-title" className="flex flex-col gap-2">
        <h2 id="upcoming-title" className="text-h2 font-extrabold">
          {t('client.upcoming')}
        </h2>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl bg-ink-50 p-4">
            <p className="text-sm text-ink-600">{t('client.noUpcoming')}</p>
            <ButtonLink to={`${lp('/admin/appointments/new')}?clientId=${detail.client.id}`} size="sm" variant="outline" icon={CalendarAddIcon}>
              {t('client.book')}
            </ButtonLink>
          </div>
        ) : (
          <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
            {upcoming.map((a) => (
              <AppointmentRow key={a.id} appointment={a} withDate withMaster />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-2">
        <h2 id="history-title" className="text-h2 font-extrabold">
          {t('client.history')}
        </h2>
        {past.length === 0 ? (
          <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">{t('client.noHistory')}</p>
        ) : (
          <>
            <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
              {past.slice(0, shown).map((a) => (
                <AppointmentRow key={a.id} appointment={a} withDate withMaster />
              ))}
            </ul>
            {past.length > shown ? (
              <Button variant="ghost" size="md" onClick={() => setShown((n) => n + HISTORY_STEP)} className="self-start">
                {t('client.showMore', { count: Math.min(HISTORY_STEP, past.length - shown) })}
              </Button>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function useUpdateClient(detail: ClientDetail) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientPatch) => adminApi.updateClient(detail.client.id, input),
    onSuccess: (client) => {
      queryClient.setQueryData<ClientDetail>(adminQueries.client(client.id).queryKey, (old) => (old ? { ...old, client } : old));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'clients'] });
    },
  });
}

/** Name, phone, email (walk-ins only; app users manage theirs) and the studio's private notes. */
function DetailsForm({ detail }: { detail: ClientDetail }) {
  const { t } = useTranslation(['admin', 'common']);
  const { client } = detail;
  const initial: ClientFieldValues = { name: client.name, surname: client.surname, phone: client.phone ?? '', email: client.email ?? '' };
  const [values, setValues] = useState<ClientFieldValues>(initial);
  const [notes, setNotes] = useState(client.notes);
  const [touched, setTouched] = useState(false);
  const update = useUpdateClient(detail);

  const patch: ClientPatch = {};
  if (values.name.trim() !== client.name) patch.name = values.name.trim();
  if (values.surname.trim() !== client.surname) patch.surname = values.surname.trim();
  if (values.phone.trim() !== (client.phone ?? '')) patch.phone = values.phone.trim() || null;
  if (!client.hasAccount && values.email.trim() && values.email.trim() !== (client.email ?? '')) patch.email = values.email.trim();
  if (notes.trim() !== client.notes) patch.notes = notes.trim();
  const dirty = Object.keys(patch).length > 0;

  const issues = touched ? clientFieldIssues(values, { phoneRequired: false }) : {};
  const server = fieldErrors(t, update.error);
  const errors = { ...server, ...Object.fromEntries(Object.entries(issues).map(([key, code]) => [key, t(`common:validation.${code}`)])) };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(clientFieldIssues(values, { phoneRequired: false })).length > 0 || !dirty) return;
    update.mutate(patch, { onSuccess: () => toast.success(t('common.saved')) });
  };

  return (
    <section aria-labelledby="details-title" className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <h2 id="details-title" className="text-h3 font-extrabold">
        {t('client.details')}
      </h2>
      <form className="mt-4 flex flex-col gap-4" onSubmit={submit} noValidate>
        <ClientFields
          values={values}
          onChange={setValues}
          errors={errors}
          phoneRequired={false}
          emailLocked={client.hasAccount}
          emailHint={client.hasAccount ? t('client.emailLocked') : client.email ? undefined : t('booking.emailHint')}
        />
        <Textarea
          label={t('client.notes')}
          hint={t('client.notesHint')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
        />
        {update.isError && Object.keys(server).length === 0 ? <Alert>{errorMessage(t, update.error)}</Alert> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="md" disabled={!dirty} loading={update.isPending} className="min-w-32">
            {t('common.save')}
          </Button>
          {dirty ? (
            <Button
              size="md"
              variant="ghost"
              onClick={() => {
                setValues(initial);
                setNotes(client.notes);
                setTouched(false);
              }}
            >
              {t('appointment.discard')}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** Pause or allow online booking for this client (staff can still book them). */
function BookingAccess({ detail }: { detail: ClientDetail }) {
  const { t } = useTranslation(['admin', 'common']);
  const { client } = detail;
  const [confirming, setConfirming] = useState(false);
  const update = useUpdateClient(detail);
  const set = (blocked: boolean) =>
    update.mutate(
      { bookingBlocked: blocked },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success(blocked ? t('client.blockedToast') : t('client.unblockedToast'));
        },
        onError: (error) => {
          if (!blocked) toast.error(errorMessage(t, error));
        },
      },
    );

  return (
    <section aria-label={t('client.onlineBooking')} className="rounded-2xl bg-ink-50 p-4">
      <Switch
        checked={!client.bookingBlocked}
        disabled={update.isPending}
        onChange={(allowed) => {
          if (allowed) set(false);
          else {
            update.reset();
            setConfirming(true);
          }
        }}
        label={t('client.onlineBooking')}
        description={client.bookingBlocked ? t('client.onlineBookingOff') : t('client.onlineBookingOn')}
      />
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => set(true)}
        title={t('client.blockTitle', { name: client.name })}
        description={t('client.blockText')}
        confirmLabel={t('client.block')}
        loading={update.isPending}
        error={confirming ? update.error : null}
      />
    </section>
  );
}
