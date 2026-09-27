import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from '@/components/ui';
import { StarOutlineIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { RATINGS } from '@/lib/feedback';
import { formatDayShort } from '@/lib/format';
import { feedbackApi, feedbackQueries } from '@/services/api/feedback';

/**
 * Home, after a completed visit: "How was your visit with Alina?" and the five stars. A star opens
 * the feedback page with that rating chosen (the client still sends it there); "Not now" closes
 * the card for that visit for good.
 */
export function FeedbackPrompt({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation(['feedback', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone } = useStudio();
  const titleId = useId();
  const queryClient = useQueryClient();
  const pending = useQuery(feedbackQueries.pending());
  const { queryKey } = feedbackQueries.pending();
  const dismiss = useMutation({
    mutationFn: feedbackApi.dismiss,
    // Gone at once; it comes back only if the studio could not be told.
    onMutate: () => queryClient.setQueryData(queryKey, null),
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.error(errorMessage(t, error));
    },
  });

  const visit = pending.data;
  if (!visit) return null;
  const services = visit.services.map((name) => pick(name)).join(', ');

  return (
    <section
      aria-labelledby={titleId}
      style={style}
      className={cx(
        'rounded-2xl bg-white px-4 pb-1.5 pt-3.5 ring-1 ring-inset ring-ink-100',
        className,
      )}
    >
      <h2 id={titleId} className="text-[0.9375rem] font-bold">
        {visit.master ? t('prompt.title', { name: visit.master }) : t('prompt.titleStudio')}
      </h2>
      <p className="truncate text-sm text-ink-600 first-letter:uppercase">
        {formatDayShort(visit.start, locale, timeZone)} · {services}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center justify-between">
        <div role="group" aria-labelledby={titleId} className="-ml-2.5 flex">
          {RATINGS.map((rating) => (
            <Link
              key={rating}
              to={`${lp('/feedback')}?visit=${visit.id}&rating=${rating}`}
              aria-label={t('stars', { count: rating })}
              className="press inline-flex size-11 items-center justify-center rounded-pill text-[1.875rem] text-rose-500 hover:bg-blush-100"
            >
              <StarOutlineIcon fontSize="inherit" />
            </Link>
          ))}
        </div>
        <button
          type="button"
          onClick={() => dismiss.mutate(visit.id)}
          className="press -mr-2 h-11 rounded-pill px-3 text-sm font-semibold text-ink-600 hover:bg-ink-50 hover:text-ink-900"
        >
          {t('prompt.notNow')}
        </button>
      </div>
    </section>
  );
}
