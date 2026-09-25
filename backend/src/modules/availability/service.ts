import type { ObjectId } from 'mongodb';
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
  return ordered as ServiceDoc[];
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

  const [appointmentDocs, timeOffDocs] = await Promise.all([
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

  return { settings, services, durationMin, staff, appointments, timeOff, closures };
}

export function bookingWindow(settings: StudioSettings, now: Date) {
  const today = todayIn(settings.timezone, now);
  return { first: today, last: addDays(today, settings.horizonDays) };
}

export function slotsForDate(ctx: AvailabilityContext, date: string, now: Date): Slot[] {
  const { first, last } = bookingWindow(ctx.settings, now);
  if (date < first || date > last) return [];
  return computeDaySlots({
    date,
    timeZone: ctx.settings.timezone,
    durationMin: ctx.durationMin,
    stepMin: ctx.settings.slotStepMin,
    bufferMin: ctx.settings.bufferMin,
    earliestStart: now.getTime() + ctx.settings.leadTimeMin * MINUTE,
    staff: ctx.staff.map((s) => ({ id: s._id.toHexString(), weekly: s.weekly })),
    appointments: ctx.appointments,
    timeOff: ctx.timeOff,
    closures: ctx.closures,
  });
}
