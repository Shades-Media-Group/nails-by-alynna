import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ServiceLines } from '@/components/appointments/ServiceLines';
import { Alert } from '@/components/common/Alert';
import { StarRating } from '@/components/feedback/StarRating';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, ButtonLink, Skeleton, Textarea } from '@/components/ui';
import { CheckIcon, RateReviewIcon, ReplayIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { ratingFrom } from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';
import { isApiError } from '@/services/api/client';
import { feedbackApi } from '@/services/api/feedback';
import { queries } from '@/services/queries';
import type { Appointment, FeedbackRating } from '@/types/api';

const COMMENT_MAX = 1000;
/** A message to the studio needs a few words; a visit can get stars alone (the API agrees). */
const GENERAL_MIN = 3;
/** Visits can be rated for two weeks after they end. */
const WINDOW_MS = 14 * 86_400_000;
const OBJECT_ID = /^[a-f\d]{24}$/i;

interface Sent {
  visit: boolean;
  master: string | null;
}

/**
 * /feedback — what the client thinks. With ?visit=<id> (the email, the card on Home) it is about
 * that completed visit: stars first (?rating=N chooses them; the numbers in the email use it) and
 * an optional comment. Without it, a message to the studio, stars optional. Once sent: a thank-you
 * and the way home.
 */
export default function FeedbackPage() {
  const [params] = useSearchParams();
  const visitId = params.get('visit');
  const preset = ratingFrom(params.get('rating'));
  const [sent, setSent] = useState<Sent | null>(null);

  if (sent) return <ThankYou {...sent} />;
  if (visitId === null)
    return <FeedbackForm key="general" visit={null} preset={preset} onSent={setSent} />;
  return <VisitFeedback key={visitId} id={visitId} preset={preset} onSent={setSent} />;
}

function VisitFeedback({
  id,
  preset,
  onSent,
}: {
  id: string;
  preset: FeedbackRating | null;
  onSent: (sent: Sent) => void;
}) {
  const { t } = useTranslation(['feedback', 'common']);
  const [openedAt] = useState(() => Date.now());
  const valid = OBJECT_ID.test(id);
  // Loaded once: nothing about a finished visit changes while the client writes.
  const visit = useQuery({
    ...queries.appointment(id),
    enabled: valid,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  if (!valid || (visit.isError && isApiError(visit.error, 'NOT_FOUND')))
    return <Unavailable>{t('visit.notFound')}</Unavailable>;
  if (visit.isPending) {
    return (
      <Frame title={t('visit.title')}>
        <div className="flex flex-col gap-5" aria-busy="true">
          <Skeleton rounded="xl" className="h-24" />
          <Skeleton rounded="xl" className="h-40" />
        </div>
      </Frame>
    );
  }
  if (visit.isError) {
    return (
      <Frame title={t('visit.title')}>
        <div className="flex flex-col items-start gap-3">
          <Alert>{errorMessage(t, visit.error)}</Alert>
          <Button
            variant="outline"
            size="sm"
            icon={ReplayIcon}
            onClick={() => void visit.refetch()}
          >
            {t('common:actions.retry')}
          </Button>
        </div>
      </Frame>
    );
  }
  const appointment = visit.data;
  if (appointment.status !== 'completed') return <Unavailable>{t('visit.notDone')}</Unavailable>;
  if (openedAt - new Date(appointment.end).getTime() > WINDOW_MS)
    return <Unavailable>{t('visit.closed')}</Unavailable>;
  return <FeedbackForm visit={appointment} preset={preset} onSent={onSent} />;
}

function FeedbackForm({
  visit,
  preset,
  onSent,
}: {
  visit: Appointment | null;
  preset: FeedbackRating | null;
  onSent: (sent: Sent) => void;
}) {
  const { t } = useTranslation(['feedback', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const queryClient = useQueryClient();
  const ratingLabelId = useId();
  const stars = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLTextAreaElement>(null);
  const [rating, setRating] = useState<FeedbackRating | null>(preset);
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const master = visit?.staff?.name ?? null;

  const send = useMutation({
    mutationFn: feedbackApi.send,
    onSuccess: () => {
      // The card on Home has nothing left to ask about.
      void queryClient.invalidateQueries({ queryKey: ['feedback'] });
      onSent({ visit: visit !== null, master });
    },
  });

  const text = comment.trim();
  const server = fieldErrors(t, send.error);
  const ratingError = tried && visit && rating === null ? t('visit.ratingRequired') : server.rating;
  const commentError =
    tried && !visit && text.length < GENERAL_MIN ? t('general.commentRequired') : server.comment;
  const otherError =
    send.isError && !server.rating && !server.comment ? errorMessage(t, send.error) : null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (visit && rating === null) {
      stars.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
      return;
    }
    if (!visit && text.length < GENERAL_MIN) {
      message.current?.focus();
      return;
    }
    send.mutate(
      visit ? { appointmentId: visit.id, rating, comment: text } : { rating, comment: text },
    );
  };

  const ratingField = (
    <div ref={stars}>
      <p id={ratingLabelId} className="text-sm font-medium text-ink-700">
        {visit ? t('visit.rating') : t('general.rating')}
      </p>
      <StarRating
        value={rating}
        onChange={setRating}
        labelledBy={ratingLabelId}
        error={ratingError}
        className="mt-1"
      />
    </div>
  );
  const commentField = (
    <Textarea
      ref={message}
      label={visit ? t('visit.comment') : t('general.comment')}
      hint={visit ? t('visit.commentHint') : t('general.commentHint')}
      error={commentError}
      value={comment}
      onChange={(event) => setComment(event.target.value)}
      maxLength={COMMENT_MAX}
      rows={5}
    />
  );

  return (
    <Frame
      title={visit ? t('visit.title') : t('general.title')}
      subtitle={
        visit
          ? master
            ? t('visit.subtitle', { name: master })
            : t('visit.subtitleStudio')
          : t('general.subtitle')
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {visit ? (
          <div className="rounded-2xl bg-ink-50 p-4">
            <p className="font-bold first-letter:uppercase">
              {formatDateTime(visit.start, locale, timeZone)}
            </p>
            <ServiceLines appointment={visit} className="mt-0.5 text-sm text-ink-600" />
            {master ? (
              <p className="mt-0.5 text-sm text-ink-600">
                {t('visit.withMaster', { name: master })}
              </p>
            ) : null}
          </div>
        ) : null}
        {/* A visit is rated first, a comment is optional; a message leads, stars are optional. */}
        {visit ? ratingField : commentField}
        {visit ? commentField : ratingField}
        {otherError ? <Alert>{otherError}</Alert> : null}
        <Button type="submit" icon={RateReviewIcon} loading={send.isPending} fullWidth>
          {t('send')}
        </Button>
      </form>
    </Frame>
  );
}

/** The page's header and its column. */
function Frame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="pb-6">
      <PageHeader title={title} subtitle={subtitle} back />
      <div className="gutter-x mt-5 max-w-xl lg:px-0">{children}</div>
    </div>
  );
}

/** A visit that can't be rated (not the client's, not done yet, or too long ago): a message to the studio still can. */
function Unavailable({ children }: { children: ReactNode }) {
  const { t } = useTranslation('feedback');
  const { lp } = useLocale();
  return (
    <Frame title={t('visit.title')}>
      <div className="flex flex-col items-start gap-4">
        <Alert tone="info">{children}</Alert>
        <ButtonLink to={lp('/feedback')} replace variant="soft" size="md" icon={RateReviewIcon}>
          {t('visit.writeInstead')}
        </ButtonLink>
      </div>
    </Frame>
  );
}

function ThankYou({ visit, master }: Sent) {
  const { t } = useTranslation('feedback');
  const { lp } = useLocale();
  return (
    <div className="gutter-x flex flex-col items-center pb-6 pt-[calc(var(--safe-top)+3.5rem)] text-center lg:px-0 lg:pt-20">
      <span
        aria-hidden="true"
        className="inline-flex size-16 animate-pop items-center justify-center rounded-pill bg-mint-50 text-[2rem] text-mint-700"
      >
        <CheckIcon fontSize="inherit" />
      </span>
      <h1 className="mt-5 text-h1 font-extrabold" tabIndex={-1} ref={(el) => el?.focus()}>
        {t('thanks.title')}
      </h1>
      <p className="mt-2 max-w-sm text-ink-600">
        {visit
          ? master
            ? t('thanks.visit', { name: master })
            : t('thanks.visitStudio')
          : t('thanks.general')}
      </p>
      <ButtonLink to={lp('/home')} replace fullWidth className="mt-7 max-w-sm">
        {t('thanks.home')}
      </ButtonLink>
    </div>
  );
}
