import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { Filter } from '../../db';
import { FEEDBACK_RATINGS, type AppointmentDoc, type FeedbackDoc, type FeedbackRating, type UserDoc } from '../../db/types';
import { DAY } from '../../lib/time';

/** How long after a visit its client may rate it, or change what they said. */
export const FEEDBACK_WINDOW_MS = 14 * DAY;

/** A completed visit that ended less than two weeks ago can get (or change) its feedback. */
export function feedbackOpen(visit: Pick<AppointmentDoc, 'status' | 'end'>, now: Date): boolean {
  return visit.status === 'completed' && visit.end.getTime() >= now.getTime() - FEEDBACK_WINDOW_MS;
}

/**
 * The visit the card on Home asks about: the client's most recent completed visit of the last two
 * weeks that has no feedback yet and whose card they did not close. A visit the master marked done
 * before its planned end counts as over.
 */
export async function pendingVisit(deps: AppDeps, clientId: ObjectId, now: Date): Promise<AppointmentDoc | null> {
  const recent = await deps.col.appointments
    .find({
      clientId,
      status: 'completed',
      end: { $gte: new Date(now.getTime() - FEEDBACK_WINDOW_MS) },
      feedbackDismissedAt: null,
    })
    .sort({ end: -1 })
    .limit(10)
    .toArray();
  if (recent.length === 0) return null;
  const rated = await deps.col.feedback
    .find({ appointmentId: { $in: recent.map((a) => a._id) } }, { projection: { appointmentId: 1 } })
    .toArray();
  const done = new Set(rated.map((f) => String(f.appointmentId)));
  return recent.find((a) => !done.has(a._id.toHexString())) ?? null;
}

export type FeedbackScope = 'all' | 'own' | 'none';

/**
 * Whose feedback a staff member reads: the owner all of it (general feedback included), a master
 * what clients said about their own visits, other staff (reception) none.
 */
export async function feedbackScope(deps: AppDeps, user: UserDoc): Promise<{ scope: FeedbackScope; filter: Filter<FeedbackDoc> | null }> {
  if (user.role === 'administrator') return { scope: 'all', filter: {} };
  // A master profile that was switched off still owns the feedback on the visits it had.
  const profiles = await deps.col.staff.find({ userId: user._id }, { projection: { _id: 1 } }).toArray();
  if (profiles.length === 0) return { scope: 'none', filter: null };
  return { scope: 'own', filter: { staffId: { $in: profiles.map((p) => p._id) } } };
}

export interface FeedbackSummary {
  /** Mean of the ratings, one decimal; null before the first rating. */
  average: number | null;
  /** How many ratings the average is made of. */
  count: number;
  byRating: Record<FeedbackRating, number>;
  /** Everything in the list, general feedback without stars included. */
  total: number;
}

/** The numbers at the top of the staff list, from the count of each rating. */
export function summarize(counts: Array<{ _id: unknown; count: number }>, total: number): FeedbackSummary {
  const byRating = Object.fromEntries(FEEDBACK_RATINGS.map((r) => [r, 0])) as Record<FeedbackRating, number>;
  for (const row of counts) {
    if (FEEDBACK_RATINGS.includes(row._id as FeedbackRating)) byRating[row._id as FeedbackRating] = row.count;
  }
  const count = FEEDBACK_RATINGS.reduce((sum, r) => sum + byRating[r], 0);
  const points = FEEDBACK_RATINGS.reduce((sum, r) => sum + r * byRating[r], 0);
  return { average: count > 0 ? Math.round((points / count) * 10) / 10 : null, count, byRating, total };
}

/** What the client gets back after sending. */
export function toClientFeedback(f: FeedbackDoc) {
  return {
    id: f._id.toHexString(),
    kind: f.kind,
    appointmentId: f.appointmentId?.toHexString() ?? null,
    rating: f.rating,
    comment: f.comment,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}
