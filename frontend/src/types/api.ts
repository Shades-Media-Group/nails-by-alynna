import type { Locale } from '@/i18n/config';
import type { SwatchColor } from '@/lib/swatch';

/** Shapes returned by the API (backend/src/modules/**). Dates are ISO strings. */

export type I18nText = Record<Locale, string>;
export type Role = 'client' | 'admin' | 'administrator';
export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
type LengthLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** Illustration for a service; length-N / refill-N draw a nail at size N with guide lines. */
export type ServiceArt =
  | 'gel'
  | 'french'
  | 'extension'
  | 'pedicure'
  | 'design'
  | 'removal'
  | 'care'
  | `length-${LengthLevel}`
  | `refill-${LengthLevel}`;

export interface User {
  id: string;
  email: string;
  name: string;
  surname: string;
  phone: string | null;
  role: Role;
  locale: Locale;
  hasPassword: boolean;
  hasGoogle: boolean;
  bookingBlocked: boolean;
  /** Shared read-only demo account (nothing it does is saved). */
  isDemo: boolean;
  createdAt: string;
}

export interface PublicConfig {
  auth: { google: boolean; demo: Role[] };
  studio: {
    name: string;
    tagline: I18nText;
    about: I18nText;
    address: string;
    city: string;
    mapsUrl: string;
    phone: string;
    whatsapp: string;
    viber: string;
    telegram: string;
    instagram: string;
    email: string;
    timezone: string;
    currency: string;
  };
  booking: {
    requireApproval: boolean;
    cancellationWindowHours: number;
    leadTimeMin: number;
    horizonDays: number;
    maxActiveBookings: number;
    policy: I18nText;
    mastersCount: number;
  };
}

export interface Category {
  id: string;
  slug: string;
  name: I18nText;
  /** Shown under the heading, e.g. what "size" means. */
  description: I18nText | null;
  /** Options of one thing (lengths): a visit takes at most one of them. */
  singleChoice: boolean;
  color: SwatchColor;
}

export interface Service {
  id: string;
  categoryId: string;
  slug: string;
  name: I18nText;
  description: I18nText;
  durationMin: number;
  price: number;
  priceFrom: boolean;
  art: ServiceArt;
  isPopular: boolean;
}

export interface Catalog {
  categories: Category[];
  services: Service[];
}

export interface StaffMember {
  id: string;
  name: string;
  title: I18nText;
  color: SwatchColor;
  serviceIds: string[] | null;
  weekly: Array<Array<{ start: string; end: string }>>;
}

export interface Slot {
  start: string;
  time: string;
  staffIds: string[];
}

export interface AvailabilityDays {
  durationMin: number;
  window: { first: string; last: string };
  staffCount: number;
  days: Array<{ date: string; slots: number }>;
}

export interface AppointmentLine {
  id: string;
  name: I18nText;
  durationMin: number;
  price: number;
  priceFrom: boolean;
}

export interface Appointment {
  id: string;
  code: string;
  status: AppointmentStatus;
  start: string;
  end: string;
  durationMin: number;
  totalPrice: number;
  priceFrom: boolean;
  services: AppointmentLine[];
  staff: { id: string; name: string; title: I18nText; color: SwatchColor } | null;
  notes: string;
  canChange: boolean;
  changeDeadline: string;
  cancelledAt: string | null;
  cancelledBy: 'client' | 'staff' | null;
  createdAt: string;
}

export interface StaffAppointment extends Appointment {
  client: { id: string; name: string; surname: string; phone: string | null; email: string };
  staffNotes: string;
  source: 'client' | 'staff';
  cancelReason: string;
  clientStats: { visits: number; noShows: number };
}

export interface DeviceSession {
  id: string;
  userAgent: string;
  ip: string;
  remember: boolean;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; requestId?: string };
}
