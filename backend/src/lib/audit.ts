import { ObjectId } from 'bson';
import type { AppDeps } from '../context';

/** Records security-relevant and administrative actions. Never throws. */
export async function audit(
  deps: AppDeps,
  entry: {
    actorId: ObjectId | null;
    action: string;
    targetType: string;
    targetId?: ObjectId | string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await deps.col.auditLogs.insertOne({
      _id: new ObjectId(),
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ? String(entry.targetId) : null,
      meta: entry.meta ?? {},
      at: deps.now(),
    });
  } catch (error) {
    console.error('[audit] failed to record', entry.action, error);
  }
}
