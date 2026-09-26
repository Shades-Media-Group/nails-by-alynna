import type { Appointment, NailShape, Service, Slot, StaffMember } from '@/types/api';

/**
 * The booking a demo account would have made, built on the device: the demo shows what comes
 * after "Send request" without sending anything (the server refuses demo writes anyway).
 */
export function demoAppointment({
  services,
  slot,
  master,
  nailShape,
  notes,
  pending,
  now = new Date(),
}: {
  services: Service[];
  slot: Slot;
  master: StaffMember | null;
  nailShape: NailShape | null;
  notes: string;
  /** The studio confirms requests itself (the request is "sent", not "booked"). */
  pending: boolean;
  now?: Date;
}): Appointment {
  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const end = new Date(new Date(slot.start).getTime() + durationMin * 60_000);
  return {
    id: 'demo',
    code: 'DEMO',
    status: pending ? 'pending' : 'confirmed',
    start: slot.start,
    end: end.toISOString(),
    durationMin,
    totalPrice: services.reduce((sum, s) => sum + s.price, 0),
    priceFrom: services.some((s) => s.priceFrom),
    services: services.map(({ id, name, durationMin: minutes, price, priceFrom }) => ({
      id,
      name,
      durationMin: minutes,
      price,
      priceFrom,
    })),
    nailShape,
    staff: master ? { id: master.id, name: master.name, title: master.title, color: master.color } : null,
    notes,
    canChange: false,
    changeDeadline: slot.start,
    cancelledAt: null,
    cancelledBy: null,
    loyalty: null,
    promo: null,
    calendarUrl: null,
    createdAt: now.toISOString(),
  };
}
