import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, type ServiceDoc, type StaffDoc, type StudioSettings } from '../../db/types';
import { AppError } from '../../lib/errors';
import { MINUTE, addDays, todayIn, zonedTimeToUtc } from '../../lib/time';
import { getSettings } from '../settings';
import { computeDaySlots, type Interval, type Slot } from './engine';

export interface AvailabilityContext {
  settings: StudioSettings;
  services: ServiceDoc[];
  durationMin: number;
  staff: StaffDoc[];
  /** Shortest service each master performs that clients can book (minutes), by staff id; smart slots only. */
  shortestServiceMin: Map<string, number>;
  appointments: Map<string, Interval[]>;
  timeOff: Map<string, Interval[]>;
  closures: Interval[];
}

const MAX_TOTAL_DURATION_MIN = 8 * 60;

/** Loads active services in the requested order; 422 if any is missing or inactive. */
export async function loadServices(deps: AppDeps, serviceIds: ObjectId[]): Promise<ServiceDoc[]> {
  const docs = await deps.col.services.find({ _id: { $in: serviceIds }, isActive: true }).toArray();
  const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
  const ordered = serviceIds.map((id) => byId.get(id.toHexString()));
  if (ordered.some((d) => !d)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Service unavailable', {
      fields: { serviceIds: 'unavailable' },
    });
  }
  await assertOnePerSingleChoiceCategory(deps, ordered as ServiceDoc[]);
  return ordered as ServiceDoc[];
}

/** Options of one thing (e.g. extension lengths) can't be combined in a single visit. */
async function assertOnePerSingleChoiceCategory(deps: AppDeps, services: ServiceDoc[]): Promise<void> {
  const perCategory = new Map<string, number>();
  for (const service of services) {
    const key = service.categoryId.toHexString();
    perCategory.set(key, (perCategory.get(key) ?? 0) + 1);
  }
  const repeated = [...perCategory].filter(([, count]) => count > 1).map(([id]) => new ObjectId(id));
  if (repeated.length === 0) return;
  const exclusive = await deps.col.categories.countDocuments({ _id: { $in: repeated }, singleChoice: true });
  if (exclusive > 0) {
    throw new AppError(422, 'ONE_PER_CATEGORY', 'Choose one option from this category', {
      fields: { serviceIds: 'one_per_category' },
    });
  }
}

export function canPerform(staff: StaffDoc, services: ServiceDoc[]): boolean {
  if (!staff.serviceIds) return true;
  const allowed = new Set(staff.serviceIds.map((id) => id.toHexString()));
  return services.every((s) => allowed.has(s._id.toHexString()));
}

export async function loadAvailabilityContext(
  deps: AppDeps,
  opts: {
    serviceIds: ObjectId[];
    staffId: ObjectId | null;
    from: string;
    to: string;
    excludeAppointmentId?: ObjectId;
  },
): Promise<AvailabilityContext> {
  const settings = await getSettings(deps);
  const services = await loadServices(deps, opts.serviceIds);
  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  if (durationMin > MAX_TOTAL_DURATION_MIN) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Too long', { fields: { serviceIds: 'too_long' } });
  }

  const staffQuery = opts.staffId
    ? { _id: opts.staffId, isActive: true, isBookable: true }
    : { isActive: true, isBookable: true };
  const staff = (await deps.col.staff.find(staffQuery).sort({ order: 1, _id: 1 }).toArray()).filter(
    (member) => canPerform(member, services),
  );

  const rangeStart = zonedTimeToUtc(opts.from, '00:00', settings.timezone);
  const rangeEnd = zonedTimeToUtc(addDays(opts.to, 1), '00:00', settings.timezone);
  const staffIds = staff.map((s) => s._id);

  const [appointmentDocs, timeOffDocs, shortestServiceMin] = await Promise.all([
    deps.col.appointments
      .find(
        {
          staffId: { $in: staffIds },
          status: { $in: ACTIVE_STATUSES },
          start: { $lt: rangeEnd },
          end: { $gt: rangeStart },
          ...(opts.excludeAppointmentId ? { _id: { $ne: opts.excludeAppointmentId } } : {}),
        },
        { projection: { staffId: 1, start: 1, end: 1 } },
      )
      .toArray(),
    deps.col.timeOff
      .find(
        { $or: [{ staffId: { $in: staffIds } }, { staffId: null }], start: { $lt: rangeEnd }, end: { $gt: rangeStart } },
        { projection: { staffId: 1, start: 1, end: 1 } },
      )
      .toArray(),
    settings.smartSlots ? shortestServices(deps, staff) : new Map<string, number>(),
  ]);

  const appointments = new Map<string, Interval[]>();
  for (const a of appointmentDocs) {
    const key = a.staffId.toHexString();
    const list = appointments.get(key) ?? [];
    list.push({ start: a.start.getTime(), end: a.end.getTime() });
    appointments.set(key, list);
  }
  const timeOff = new Map<string, Interval[]>();
  const closures: Interval[] = [];
  for (const t of timeOffDocs) {
    const interval = { start: t.start.getTime(), end: t.end.getTime() };
    if (!t.staffId) {
      closures.push(interval);
      continue;
    }
    const key = t.staffId.toHexString();
    const list = timeOff.get(key) ?? [];
    list.push(interval);
    timeOff.set(key, list);
  }

  return { settings, services, durationMin, staff, shortestServiceMin, appointments, timeOff, closures };
}

/** Per master: the shortest active service they do, in an active category — no visit fits a shorter gap. */
async function shortestServices(deps: AppDeps, staff: StaffDoc[]): Promise<Map<string, number>> {
  const [services, categories] = await Promise.all([
    deps.col.services.find({ isActive: true }, { projection: { categoryId: 1, durationMin: 1 } }).toArray(),
    deps.col.categories.find({ isActive: true }, { projection: { _id: 1 } }).toArray(),
  ]);
  const listed = new Set(categories.map((c) => c._id.toHexString()));
  const bookable = services.filter((s) => listed.has(s.categoryId.toHexString()));
  const shortest = new Map<string, number>();
  for (const member of staff) {
    const own = member.serviceIds ? new Set(member.serviceIds.map((id) => id.toHexString())) : null;
    const durations = bookable.filter((s) => !own || own.has(s._id.toHexString())).map((s) => s.durationMin);
    if (durations.length > 0) shortest.set(member._id.toHexString(), Math.min(...durations));
  }
  return shortest;
}

/** How far ahead staff can see and book (clients are limited to the studio's horizon). */
const STAFF_HORIZON_DAYS = 365;

export function bookingWindow(settings: StudioSettings, now: Date, staff = false) {
  const today = todayIn(settings.timezone, now);
  return { first: today, last: addDays(today, staff ? Math.max(settings.horizonDays, STAFF_HORIZON_DAYS) : settings.horizonDays) };
}

/**
 * Free start times on a date. Clients see the studio's rules (lead time, horizon) and, with smart
 * slots on, only the times that keep each master's day compact (see engine.ts); the booking then
 * goes to the master it fits best. Staff booking at the desk or on the phone see every free time
 * from now on, and can always override.
 */
export function slotsForDate(ctx: AvailabilityContext, date: string, now: Date, opts: { staff?: boolean } = {}): Slot[] {
  const { settings } = ctx;
  const { first, last } = bookingWindow(settings, now, opts.staff);
  if (date < first || date > last) return [];
  return computeDaySlots({
    date,
    timeZone: settings.timezone,
    durationMin: ctx.durationMin,
    stepMin: settings.slotStepMin,
    bufferMin: settings.bufferMin,
    earliestStart: now.getTime() + (opts.staff ? 0 : settings.leadTimeMin) * MINUTE,
    staff: ctx.staff.map((s) => {
      const id = s._id.toHexString();
      return { id, weekly: s.weekly, bufferMin: s.bufferMin ?? 0, shortestServiceMin: ctx.shortestServiceMin.get(id) };
    }),
    appointments: ctx.appointments,
    timeOff: ctx.timeOff,
    closures: ctx.closures,
    smart:
      settings.smartSlots && !opts.staff
        ? { maxGapMin: settings.maxGapMin, minBookableGapMin: settings.minBookableGapMin }
        : null,
  });
}
