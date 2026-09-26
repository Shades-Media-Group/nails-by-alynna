import { queryOptions } from '@tanstack/react-query';
import type { Feedback, FeedbackInput, PendingFeedbackVisit } from '@/types/api';
import { api } from './client';

/** Feedback on a visit, or on the studio and the app (backend/src/modules/feedback). */
export const feedbackApi = {
  /** The latest completed visit of the last two weeks not rated yet, if the card wasn't closed. */
  pending: () =>
    api.get<{ visit: PendingFeedbackVisit | null }>('/feedback/pending').then((r) => r.visit),
  /** Sending again about the same visit changes what was sent. */
  send: (input: FeedbackInput) =>
    api.post<{ feedback: Feedback }>('/feedback', input).then((r) => r.feedback),
  /** "Not now" on Home: that visit is not asked about in the app again. */
  dismiss: (appointmentId: string) =>
    api.post<{ ok: true }>('/feedback/dismiss', { appointmentId }),
};

export const feedbackQueries = {
  pending: () =>
    queryOptions({
      queryKey: ['feedback', 'pending'],
      queryFn: feedbackApi.pending,
      staleTime: 60_000,
    }),
};
