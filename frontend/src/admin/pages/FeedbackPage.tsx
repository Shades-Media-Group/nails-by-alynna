import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Stars } from '@/components/feedback/StarRating';
import { Badge, Chip, EmptyState, Skeleton } from '@/components/ui';
import { ChevronRightIcon, RateReviewIcon, StarIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { LOCALE_TAGS } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { formatDayShort, fullName } from '@/lib/format';
import type { FeedbackRating } from '@/types/api';
import { adminQueries, type AdminFeedback, type FeedbackList } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { Pagination } from '../components/Pagination';

const BEST_FIRST: FeedbackRating[] = [5, 4, 3, 2, 1];

/**
 * Feedback (route /admin/feedback), laid out like the ratings and reviews of an App Store page:
 * the average and how many ratings on top, one chip per rating, then what clients wrote, newest
 * first. The owner reads everything, general messages included; a master reads what clients said
 * about their own visits (the API decides).
 */
export default function FeedbackPage() {
  const { t } = useTranslation(['feedback', 'admin', 'common']);
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [page, setPage] = useState(1);
  const list = useQuery(adminQueries.feedback({ page, rating }));
  const data = list.data;
  const scope = data?.scope;

  const choose = (next: FeedbackRating | null) => {
    setRating(next);
    setPage(1);
  };

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('admin.title')}
        subtitle={
          scope === 'all'
            ? t('admin.subtitleOwner')
            : scope === 'own'
              ? t('admin.subtitleMaster')
              : undefined
        }
      />

      <div className="gutter-x mt-6 flex flex-col gap-4 lg:px-0">
        {list.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton rounded="xl" className="h-20" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-24" />
            ))}
          </div>
        ) : list.isError ? (
          <Alert>{errorMessage(t, list.error)}</Alert>
        ) : data!.summary.total === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
            <EmptyState
              icon={RateReviewIcon}
              tone="lilac"
              title={t('admin.empty')}
              description={
                scope === 'all'
                  ? t('admin.emptyOwner')
                  : scope === 'own'
                    ? t('admin.emptyMaster')
                    : t('admin.emptyNone')
              }
            />
          </div>
        ) : (
          <>
            <Summary summary={data!.summary} />
            <div
              role="group"
              aria-label={t('admin.filter')}
              className="no-scrollbar -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] pb-1 lg:mx-0 lg:flex-wrap lg:px-0"
            >
              <Chip
                selected={rating === null}
                count={data!.summary.total}
                onClick={() => choose(null)}
              >
                {t('admin.all')}
              </Chip>
              {BEST_FIRST.map((value) => (
                <Chip
                  key={value}
                  selected={rating === value}
                  icon={StarIcon}
                  count={data!.summary.byRating[value]}
                  aria-label={t('admin.chipLabel', {
                    stars: t('stars', { count: value }),
                    amount: data!.summary.byRating[value],
                  })}
                  onClick={() => choose(value)}
                >
                  {value}
                </Chip>
              ))}
            </div>
            {data!.feedback.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-ink-600 ring-1 ring-inset ring-ink-100">
                {t('admin.emptyFilter')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-ink-100 rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
                {data!.feedback.map((feedback) => (
                  <FeedbackRow key={feedback.id} feedback={feedback} showMaster={scope === 'all'} />
                ))}
              </ul>
            )}
            <Pagination
              page={data!.page}
              pages={data!.pages}
              onPage={setPage}
              busy={list.isPlaceholderData}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** "4,8 ★★★★★ out of 5 · 12 ratings": the average over every rating in the list. */
function Summary({ summary }: { summary: FeedbackList['summary'] }) {
  const { t } = useTranslation('feedback');
  const { locale } = useLocale();
  if (summary.average === null) {
    return (
      <p className="rounded-2xl bg-white px-4 py-4 text-sm text-ink-600 ring-1 ring-inset ring-ink-100">
        {t('admin.noRatings')}
      </p>
    );
  }
  const average = new Intl.NumberFormat(LOCALE_TAGS[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(summary.average);
  return (
    <section
      aria-label={t('admin.average')}
      className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100"
    >
      <p className="tabular text-[2.25rem] font-extrabold leading-none tracking-[-0.03em]">
        {average}
      </p>
      <div className="min-w-0">
        <Stars value={summary.average} decorative className="text-xl" />
        <p className="text-sm text-ink-600">
          {t('admin.outOf')} · {t('admin.ratings', { count: summary.count })}
        </p>
      </div>
    </section>
  );
}

/** One piece of feedback: its stars (or "General"), the words, who wrote it and about which visit. */
function FeedbackRow({
  feedback: f,
  showMaster,
}: {
  feedback: AdminFeedback;
  showMaster: boolean;
}) {
  const { t } = useTranslation(['feedback', 'admin']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const pick = useI18nText();
  const day = (iso: string) => {
    const label = formatDayShort(iso, locale, timeZone);
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  };
  // Changed later by the client (a second send about the same visit).
  const edited = new Date(f.updatedAt).getTime() - new Date(f.createdAt).getTime() > 60_000;
  const about = f.visit
    ? [
        t('admin.visit', { date: formatDayShort(f.visit.start, locale, timeZone) }),
        f.visit.services.map((name) => pick(name)).join(', '),
        showMaster && f.master ? t('admin.withMaster', { name: f.master.name }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          {f.rating !== null ? <Stars value={f.rating} className="text-lg" /> : null}
          {f.kind === 'general' ? <Badge tone="lilac">{t('admin.general')}</Badge> : null}
        </span>
        <time dateTime={f.createdAt} className="tabular text-xs text-ink-500">
          {day(f.createdAt)}
          {edited ? ` · ${t('admin.edited')}` : ''}
        </time>
      </div>
      {f.comment ? (
        <p className="whitespace-pre-line break-words text-[0.9375rem] leading-relaxed text-ink-900">
          {f.comment}
        </p>
      ) : null}
      <p className="text-sm text-ink-600">
        <span className="font-semibold text-ink-800">{f.client ? fullName(f.client) : '—'}</span>
        {about ? ` · ${about}` : ''}
      </p>
      {f.visit ? (
        <Link
          to={lp(`/admin/appointments/${f.visit.id}`)}
          className="group inline-flex w-fit items-center gap-0.5 rounded-pill text-sm font-semibold text-rose-700 hover:text-rose-600"
        >
          {t('admin.openBooking')}
          <ChevronRightIcon
            fontSize="inherit"
            className="text-base transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}
    </li>
  );
}
