import { ObjectId } from 'mongodb';
import type { AppDeps } from '../../context';
import {
  ACTIVE_STATUSES,
  type AppointmentDoc,
  type AppointmentStatus,
  type StaffDoc,
  type StudioSettings,
  type UserDoc,
} from '../../db/types';
import { bookingCode } from '../../lib/crypto';
import { AppError, isDuplicateKey } from '../../lib/errors';
import { HOUR, MINUTE, toZonedParts } from '../../lib/time';
import { getSettings } from '../settings';
import { canPerform, loadAvailabilityContext, loadServices, slotsForDate } from '../availability/service';
import type { LoyaltyTag } from '../loyalty/service';

/**
 * Double-booking protection without transactions: after writing a placement we look for an
 * overlapping active appointment of the same master that was placed earlier. The earliest
 * placement (placedAt, then _id) always wins; the later one rolls itself back.
 */
async function findEarlierOverlap(
  deps: AppDeps,
  doc: Pick<AppointmentDoc, '_id' | 'staffId' | 'start' | 'end' | 'placedAt'>,
  bufferMin: number,
): Promise<AppointmentDoc | null> {
  const buffer = bufferMin * MINUTE;
  return deps.col.appointments.findOne({
    _id: { $ne: doc._id },
    staffId: doc.staffId,
    status: { $in: ACTIVE_STATUSES },
    start: { $lt: new Date(doc.end.getTime() + buffer) },
    end: { $gt: new Date(doc.start.getTime() - buffer) },
    $or: [
      { placedAt: { $lt: doc.placedAt } },
      { placedAt: doc.placedAt, _id: { $lt: doc._id } },
    ],
  });
}

async function resolveStaff(
  deps: AppDeps,
  staffId: ObjectId | null,
  services: Awaited<ReturnType<typeof loadServices>>,
  /** For "any master" at a chosen time: prefer a master who is free then. */
  at?: { start: Date; end: Date; bufferMin: number },
): Promise<StaffDoc> {
  const staff = await deps.col.staff
    .find(staffId ? { _id: staffId, isActive: true } : { isActive: true, isBookable: true })
    .sort({ order: 1, _id: 1 })
    .toArray();
  const capable = staff.filter((s) => canPerform(s, services));
  let member = capable[0] ?? (staffId ? staff[0] : undefined);
  if (!staffId && at && capable.length > 1) {
    const buffer = at.bufferMin * MINUTE;
    const busy = await deps.col.appointments.distinct('staffId', {
      staffId: { $in: capable.map((s) => s._id) },
      status: { $in: ACTIVE_STATUSES },
      start: { $lt: new Date(at.end.getTime() + buffer) },
      end: { $gt: new Date(at.start.getTime() - buffer) },
    });
    const away = await deps.col.timeOff.distinct('staffId', {
      staffId: { $in: capable.map((s) => s._id) },
      start: { $lt: at.end },
      end: { $gt: at.start },
    });
    const taken = new Set([...busy, ...away].map((id) => String(id)));
    member = capable.find((s) => !taken.has(s._id.toHexString())) ?? member;
  }
  if (!member) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Master unavailable', { fields: { staffId: 'unavailable' } });
  }
  return member;
}

export interface PlaceInput {
  client: UserDoc;
  serviceIds: ObjectId[];
  staffId: ObjectId | null;
  start: Date;
  notes: string;
  source: 'client' | 'staff';
  createdBy: ObjectId;
  status?: AppointmentStatus;
  /** Clients must pick a published slot; staff may book any time. */
  enforceSlots: boolean;
  /** Staff override: allow overlapping an existing appointment. */
  force?: boolean;
}

export async function placeAppointment(deps: AppDeps, input: PlaceInput): Promise<AppointmentDoc> {
  const settings = await getSettings(deps);
  const now = deps.now();
  const date = toZonedParts(input.start, settings.timezone).date;

  let services: Awaited<ReturnType<typeof loadServices>>;
  let staffId: ObjectId;
  if (input.enforceSlots) {
    const ctx = await loadAvailabilityContext(deps, {
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      from: date,
      to: date,
    });
    const slot = slotsForDate(ctx, date, now).find((s) => s.start === input.start.toISOString());
    const chosen = slot?.staffIds[0];
    if (!slot || !chosen) throw new AppError(409, 'SLOT_UNAVAILABLE', 'This time is no longer available');
    services = ctx.services;
    staffId = new ObjectId(chosen);
  } else {
    services = await loadServices(deps, input.serviceIds);
    const minutes = services.reduce((sum, s) => sum + s.durationMin, 0);
    staffId = (
      await resolveStaff(deps, input.staffId, services, {
        start: input.start,
        end: new Date(input.start.getTime() + minutes * MINUTE),
        bufferMin: settings.bufferMin,
      })
    )._id;
  }

  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const status: AppointmentStatus =
    input.status ?? (settings.requireApproval && input.source === 'client' ? 'pending' : 'confirmed');

  const base: Omit<AppointmentDoc, '_id' | 'code'> = {
    clientId: input.client._id,
    client: {
      name: input.client.name,
      surname: input.client.surname,
      phone: input.client.phone,
      email: input.client.email,
    },
    staffId,
    services: services.map((s) => ({
      serviceId: s._id,
      name: s.name,
      durationMin: s.durationMin,
      price: s.price,
      priceFrom: s.priceFrom,
    })),
    start: input.start,
    end: new Date(input.start.getTime() + durationMin * MINUTE),
    durationMin,
    totalPrice: services.reduce((sum, s) => sum + s.price, 0),
    priceFrom: services.some((s) => s.priceFrom),
    status,
    notes: input.notes,
    staffNotes: '',
    source: input.source,
    placedAt: now,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: '',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  let doc: AppointmentDoc | null = null;
  for (let attempt = 0; attempt < 4 && !doc; attempt++) {
    const candidate: AppointmentDoc = { ...base, _id: new ObjectId(), code: bookingCode() };
    try {
      await deps.col.appointments.insertOne(candidate);
      doc = candidate;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  if (!doc) throw new AppError(500, 'INTERNAL', 'Could not allocate a booking code');

  if (!input.force) {
    const conflict = await findEarlierOverlap(deps, doc, settings.bufferMin);
    if (conflict) {
      await deps.col.appointments.deleteOne({ _id: doc._id });
      throw new AppError(409, 'SLOT_TAKEN', 'Someone just booked this time');
    }
  }
  return doc;
}

export async function rescheduleAppointment(
  deps: AppDeps,
  appointment: AppointmentDoc,
  opts: { start: Date; staffId: ObjectId | null; enforceSlots: boolean; force?: boolean },
): Promise<AppointmentDoc> {
  if (!ACTIVE_STATUSES.includes(appointment.status)) {
    throw new AppError(409, 'INVALID_STATUS', 'Only upcoming appointments can be rescheduled');
  }
  const settings = await getSettings(deps);
  const now = deps.now();
  const serviceIds = appointment.services.map((s) => s.serviceId);
  let staffId = opts.staffId ?? appointment.staffId;

  if (opts.enforceSlots) {
    const date = toZonedParts(opts.start, settings.timezone).date;
    const ctx = await loadAvailabilityContext(deps, {
      serviceIds,
      staffId: opts.staffId,
      from: date,
      to: date,
      excludeAppointmentId: appointment._id,
    });
    const slot = slotsForDate(ctx, date, now).find((s) => s.start === opts.start.toISOString());
    if (!slot) throw new AppError(409, 'SLOT_UNAVAILABLE', 'This time is no longer available');
    const keepSame = slot.staffIds.includes(appointment.staffId.toHexString()) && !opts.staffId;
    staffId = keepSame ? appointment.staffId : new ObjectId(slot.staffIds[0]);
  }

  const previous = {
    start: appointment.start,
    end: appointment.end,
    staffId: appointment.staffId,
    placedAt: appointment.placedAt,
    updatedAt: appointment.updatedAt,
  };
  const next = {
    start: opts.start,
    end: new Date(opts.start.getTime() + appointment.durationMin * MINUTE),
    staffId,
    placedAt: now,
    updatedAt: now,
  };
  await deps.col.appointments.updateOne({ _id: appointment._id }, { $set: next });

  if (!opts.force) {
    const conflict = await findEarlierOverlap(deps, { _id: appointment._id, ...next }, settings.bufferMin);
    if (conflict) {
      await deps.col.appointments.updateOne({ _id: appointment._id }, { $set: previous });
      throw new AppError(409, 'SLOT_TAKEN', 'Someone just booked this time');
    }
  }
  return { ...appointment, ...next };
}

export function cancelDeadline(appointment: AppointmentDoc, settings: StudioSettings): Date {
  return new Date(appointment.start.getTime() - settings.cancellationWindowHours * HOUR);
}

export function clientCanChange(appointment: AppointmentDoc, settings: StudioSettings, now: Date): boolean {
  return (
    ACTIVE_STATUSES.includes(appointment.status) &&
    cancelDeadline(appointment, settings).getTime() >= now.getTime()
  );
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface StaffSummary {
  id: string;
  name: string;
  title: StaffDoc['title'];
  color: StaffDoc['color'];
}

export async function staffSummaries(deps: AppDeps, ids: ObjectId[]): Promise<Map<string, StaffSummary>> {
  const unique = [...new Set(ids.map((id) => id.toHexString()))].map((id) => new ObjectId(id));
  const docs = await deps.col.staff
    .find({ _id: { $in: unique } }, { projection: { name: 1, title: 1, color: 1 } })
    .toArray();
  return new Map(
    docs.map((d) => [d._id.toHexString(), { id: d._id.toHexString(), name: d.name, title: d.title, color: d.color }]),
  );
}

/** Per-appointment extras computed in bulk by the route: loyalty stamps and calendar links. */
export interface AppointmentExtras {
  /** Loyalty stamps (earned or expected) by appointment id, from loyalty/service loyaltyTags. */
  loyalty?: Map<string, LoyaltyTag>;
  calendar?: Map<string, string>;
}

export function toClientAppointment(
  a: AppointmentDoc,
  staff: Map<string, StaffSummary>,
  settings: StudioSettings,
  now: Date,
  extras: AppointmentExtras = {},
) {
  const stored = a.status === 'completed' && a.loyalty ? { ...a.loyalty, predicted: false } : null;
  const id = a._id.toHexString();
  return {
    id: a._id.toHexString(),
    code: a.code,
    status: a.status,
    start: a.start.toISOString(),
    end: a.end.toISOString(),
    durationMin: a.durationMin,
    totalPrice: a.totalPrice,
    priceFrom: a.priceFrom,
    services: a.services.map((s) => ({
      id: s.serviceId.toHexString(),
      name: s.name,
      durationMin: s.durationMin,
      price: s.price,
      priceFrom: s.priceFrom,
    })),
    staff: staff.get(a.staffId.toHexString()) ?? null,
    notes: a.notes,
    canChange: clientCanChange(a, settings, now),
    changeDeadline: cancelDeadline(a, settings).toISOString(),
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    cancelledBy: a.cancelledBy,
    loyalty: extras.loyalty?.get(id) ?? stored,
    /** Signed "Add to calendar" link, for visits still to come. */
    calendarUrl: extras.calendar?.get(id) ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toStaffAppointment(
  a: AppointmentDoc,
  staff: Map<string, StaffSummary>,
  settings: StudioSettings,
  now: Date,
  extras: AppointmentExtras = {},
) {
  return {
    ...toClientAppointment(a, staff, settings, now, extras),
    client: { id: a.clientId.toHexString(), ...a.client },
    staffNotes: a.staffNotes,
    source: a.source,
    cancelReason: a.cancelReason,
  };
}
