import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { UserDoc } from '../../db/types';

/**
 * Booking requests waiting for a staff member's answer: the owner answers everyone's, a master
 * their own, staff without a master profile (reception) everyone's. Shared by the staff app's
 * list (GET /api/admin/appointments/pending) and the count on its icon (staff booking pushes).
 */

/** Whose requests `user` answers: null = everyone's. */
export async function requestScope(deps: AppDeps, user: Pick<UserDoc, '_id' | 'role'>): Promise<{ staffId: ObjectId } | null> {
  if (user.role === 'administrator') return null;
  const profile = await deps.col.staff.findOne({ userId: user._id, isActive: true }, { projection: { _id: 1 } });
  return profile ? { staffId: profile._id } : null;
}

/** Requests still open: pending, and the visit not over yet (nothing left to confirm then). */
export function pendingFilter(deps: AppDeps, scope: { staffId: ObjectId } | null) {
  return { status: 'pending' as const, end: { $gt: deps.now() }, ...scope };
}

/** How many requests wait for `user` (the staff app's icon badge). */
export async function pendingRequestCount(deps: AppDeps, user: Pick<UserDoc, '_id' | 'role'>): Promise<number> {
  return deps.col.appointments.countDocuments(pendingFilter(deps, await requestScope(deps, user)));
}
