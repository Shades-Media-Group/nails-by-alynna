import type { ObjectId } from 'mongodb';
import type { Role } from '../config';
import type { Locale } from '../lib/validation';

export type I18nText = Record<Locale, string>;

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export const ACTIVE_STATUSES: AppointmentStatus[] = ['pending', 'confirmed'];

/** Tile/illustration color keys shared with the frontend design system. */
export type SwatchColor = 'blush' | 'cyan' | 'peach' | 'mint' | 'lilac';
/** Illustration keys for service artwork. */
export const LENGTH_LEVELS = [1, 2, 3, 4, 5, 6] as const;
type LengthLevel = (typeof LENGTH_LEVELS)[number];

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

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  surname: string;
  phone: string | null;
  role: Role;
  locale: Locale;
  passwordHash: string | null;
  googleId: string | null;
  /**
   * When the user proved they own `email` (Google sign-in, a password-reset link, or an
   * account set up by the studio). Missing/null = never proven.
   */
  emailVerifiedAt?: Date | null;
  /** When the user accepted the Terms and Privacy policy (sign-up). */
  termsAcceptedAt?: Date | null;
  isActive: boolean;
  /** Blocks online booking without disabling the account (e.g. repeated no-shows). */
  bookingBlocked: boolean;
  /**
   * Shared demo account: can open every screen but every change is refused and staff views
   * show masked personal data. Missing = false.
   */
  isDemo?: boolean;
  tokenVersion: number;
  /** Staff-only notes about a client. */
  notes: string;
  search: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  prevTokenHash: string | null;
  rotatedAt: Date | null;
  remember: boolean;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PasswordResetDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

/**
 * Catalog entries created from the studio's default price list carry `defaultKey`. When a new
 * default version ships, the sync updates only the fields not listed in `customized` (the ones
 * staff changed by hand). Entries staff created themselves have no `defaultKey` and are never
 * touched by the sync.
 */
export interface ManagedDefault {
  defaultKey?: string;
  customized?: string[];
}

export interface CategoryDoc extends ManagedDefault {
  _id: ObjectId;
  slug: string;
  name: I18nText;
  /** Shown under the category heading (e.g. what "size" means). */
  description?: I18nText | null;
  /** A booking takes at most one service from this category (e.g. one extension length). */
  singleChoice?: boolean;
  color: SwatchColor;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDoc extends ManagedDefault {
  _id: ObjectId;
  categoryId: ObjectId;
  slug: string;
  name: I18nText;
  description: I18nText;
  durationMin: number;
  price: number;
  /** Shows "from" before the price (final price confirmed at the studio). */
  priceFrom: boolean;
  art: ServiceArt;
  isPopular: boolean;
  isActive: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeInterval {
  start: string; // HH:mm
  end: string; // HH:mm
}

/** Index 0 = Monday … 6 = Sunday. An empty array means a day off. */
export type WeeklyHours = TimeInterval[][];

export interface StaffDoc {
  _id: ObjectId;
  name: string;
  title: I18nText;
  color: SwatchColor;
  userId: ObjectId | null;
  /** null = can perform every service. */
  serviceIds: ObjectId[] | null;
  weekly: WeeklyHours;
  isActive: boolean;
  isBookable: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeOffDoc {
  _id: ObjectId;
  /** null = the whole studio is closed. */
  staffId: ObjectId | null;
  start: Date;
  end: Date;
  reason: string;
  createdBy: ObjectId;
  createdAt: Date;
}

export interface AppointmentServiceLine {
  serviceId: ObjectId;
  name: I18nText;
  durationMin: number;
  price: number;
  priceFrom: boolean;
}

export interface AppointmentDoc {
  _id: ObjectId;
  code: string;
  clientId: ObjectId;
  client: { name: string; surname: string; phone: string | null; email: string };
  staffId: ObjectId;
  services: AppointmentServiceLine[];
  start: Date;
  end: Date;
  durationMin: number;
  totalPrice: number;
  priceFrom: boolean;
  status: AppointmentStatus;
  notes: string;
  staffNotes: string;
  source: 'client' | 'staff';
  /** Placement order used to resolve concurrent bookings of the same slot. */
  placedAt: Date;
  cancelledAt: Date | null;
  cancelledBy: 'client' | 'staff' | null;
  cancelReason: string;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudioSettings {
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
  slotStepMin: number;
  leadTimeMin: number;
  horizonDays: number;
  cancellationWindowHours: number;
  requireApproval: boolean;
  bufferMin: number;
  maxActiveBookings: number;
  policy: I18nText;
}

export interface SettingsDoc extends StudioSettings {
  _id: 'studio';
  /** Settings changed in Admin → Settings; default updates never overwrite these. */
  customized?: string[];
  updatedAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  actorId: ObjectId | null;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: Record<string, unknown>;
  at: Date;
}

export interface MetaDoc {
  _id: string;
  value: unknown;
  updatedAt: Date;
}
