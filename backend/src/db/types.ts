import type { ObjectId } from 'bson';
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
  | 'ombre'
  | 'chrome'
  | 'glitter'
  | 'design-complex'
  | 'design-3d'
  | 'design-extra'
  | 'crystals'
  | 'file'
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
  /**
   * Marked verified only because the account predates email codes (migration). Still treated
   * as unproven by the Google pre-hijack guard. Cleared once the address is really proven.
   */
  emailGrandfathered?: boolean;
  /** What the user wants to be told and how (Profile → Notifications). Missing = defaults. */
  notificationPrefs?: NotificationPrefs;
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
  /** Loyalty card number shown as a QR code in the app (see modules/loyalty). Missing = not issued yet. */
  memberCode?: string;
  /** Stamps staff added or removed by hand (visits outside the app, corrections). Missing = 0. */
  loyaltyBonus?: number;
  /** Staff-only notes about a client. */
  notes: string;
  search: string;
  /** When the client finished (or closed) the first-run intro of the app. */
  onboardedAt?: Date | null;
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

/**
 * A one-time link staff give a client who was booked in person (walk-in record without a login):
 * signing up through it turns that record into the client's account, bookings included.
 */
export interface InviteDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** sha256 of the token; the token itself only exists in the link. */
  tokenHash: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
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
  /**
   * Minutes this master keeps free after every client (cleanup, a coffee): 0–30 in 5-minute steps,
   * missing = 0. Not needed when a visit ends exactly at the end of a working interval (the last
   * client of a shift, or before a lunch break).
   */
  bufferMin?: number;
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
  /** Loyalty stamp earned when the visit was completed, with the reward applied (if any). */
  loyalty?: AppointmentLoyalty | null;
  /** The promo code on this booking and its discount on the visit's price (see modules/promo). */
  promo?: AppointmentPromo | null;
  /** A code that stopped applying when the visit was moved or restored, and why (shown on the booking). */
  promoRemoved?: RemovedPromo | null;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** One stamp on the loyalty card: which visit of the card it was and the discount it carried. */
export interface AppointmentLoyalty {
  /** Position on the card, 1..cycle. */
  visit: number;
  cycle: number;
  percent: number;
  /** Discount in the studio currency, from the visit's list price. */
  discount: number;
}

/** A reward on the loyalty card: the Nth visit of every card gets `percent` off. */
export interface LoyaltyReward {
  visit: number;
  percent: number;
}

export interface StudioSettings {
  name: string;
  /** Registered business name and IDNO (fiscal code), shown in Terms and Privacy. */
  legalName: string;
  legalId: string;
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
  /**
   * Smart slots: clients booking online see only start times that keep each master's day compact
   * (visits back to back, no gap nobody can book). Staff always see every free time.
   */
  smartSlots: boolean;
  /** Free minutes beside a visit that still count as back to back. */
  maxGapMin: number;
  /** A free gap at least this long can still take a visit; shorter ones (above maxGapMin) are dead time. */
  minBookableGapMin: number;
  maxActiveBookings: number;
  policy: I18nText;
  /** Loyalty stamp card: every completed visit is a stamp; some visits of each card get a discount. */
  loyaltyEnabled: boolean;
  /** Visits per card; the card starts again after the last one. */
  loyaltyCycle: number;
  loyaltyRewards: LoyaltyReward[];
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

// ── Notifications (email codes, reminders, Web Push) ─────────────────────────────

/** Minutes before a visit when a reminder may be sent. */
export const REMINDER_LEADS = [60, 120, 1440] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

export interface ChannelPrefs {
  email: boolean;
  push: boolean;
}

export interface NotificationPrefs {
  reminders: ChannelPrefs & { enabled: boolean; leadMinutes: ReminderLead[] };
  /** The studio confirmed, moved or cancelled a visit. */
  bookingUpdates: ChannelPrefs;
  loyalty: ChannelPrefs;
  /** News and offers: opt-in only; `consentAt` records when it was last switched on. */
  marketing: ChannelPrefs & { consentAt?: Date | null };
  updatedAt?: Date;
}

export type OtpPurpose = 'verify_email' | 'reset_password' | 'change_email';

/** A one-time 6-digit code sent by email. Only an HMAC of the code is stored. */
export interface OtpCodeDoc {
  _id: ObjectId;
  purpose: OtpPurpose;
  userId: ObjectId;
  /** Where the code was sent (for change_email: the new address). */
  email: string;
  codeHash: string;
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
  /** Used, replaced by a newer code, or locked after too many wrong tries. */
  usedAt: Date | null;
  /** Set when the email carrying this code could not be sent. */
  deliveryFailedAt?: Date | null;
}

/** One browser/device that accepted Web Push; `_id` is the sha256 of the endpoint. */
export interface PushSubscriptionDoc {
  _id: string;
  userId: ObjectId;
  /** The sign-in session on that device: signing out there stops its notifications. */
  sessionId: ObjectId | null;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
  lastSuccessAt: Date | null;
  failures: number;
}

/**
 * Every notification the system decided to send, keyed by what it is about (e.g.
 * `reminder:<appointment>:<start>:<lead>`), so each one goes out at most once even when
 * several servers or the cron run at the same moment.
 */
export interface NotificationLogDoc {
  _id: string;
  kind: 'reminder' | 'booking_update' | 'custom';
  userId: ObjectId;
  appointmentId: ObjectId | null;
  status: 'sending' | 'sent' | 'failed' | 'skipped';
  channels: { email?: 'sent' | 'failed' | 'off'; push?: 'sent' | 'failed' | 'off' | 'no_device' };
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Failed sends may be retried after this moment (transient errors only). */
  retryAt: Date | null;
}

// ── Promo codes ──────────────────────────────────────────────────────────────────

export type PromoKind = 'percent' | 'amount';

/** Why a code does not apply to a booking; the app explains each one in words. */
export type PromoProblem =
  | 'unknown'
  | 'inactive'
  | 'expired'
  | 'not_started'
  | 'used_up'
  | 'used_by_you'
  | 'first_visit'
  | 'master'
  | 'services'
  | 'min_total';

/** One use of a code, held by a booking (upcoming, or a completed visit it discounted). */
export interface PromoRedemption {
  appointmentId: ObjectId;
  clientId: ObjectId;
  at: Date;
}

/**
 * A discount code clients type when booking (modules/promo): a percentage or an amount off the
 * visit, for the whole studio or tied to one master. Its dates are visit days, in studio time.
 */
export interface PromoCodeDoc {
  _id: ObjectId;
  /** A–Z and 0–9, 3–20 characters, stored upper-case; unique. */
  code: string;
  kind: PromoKind;
  /** 1–100 for a percentage; whole units of the studio currency for an amount. */
  value: number;
  /** First and last visit day it discounts (YYYY-MM-DD, studio time), inclusive; null = open. */
  startsAt: string | null;
  endsAt: string | null;
  /** Uses in total (null = no limit) and per client. */
  maxUses: number | null;
  maxUsesPerClient: number;
  /** The visit's list total must reach this; 0 = any. */
  minTotal: number;
  /** Services it discounts; null = every service. */
  serviceIds: ObjectId[] | null;
  /** The master it belongs to: it works only on their bookings. null = the whole studio. */
  staffId: ObjectId | null;
  firstVisitOnly: boolean;
  isActive: boolean;
  /** Staff-only: who it is for, where it was shared. */
  note: string;
  /** The bookings holding a use; the number of uses is its length. */
  redemptions: PromoRedemption[];
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** A promo code on a booking, frozen when it was applied. */
export interface AppointmentPromo {
  promoId: ObjectId;
  code: string;
  kind: PromoKind;
  value: number;
  /** Discount in the studio currency on this visit's list price (the services the code covers). */
  discount: number;
  /**
   * Set when the visit is completed: true if the visit got this discount, false if its loyalty
   * discount was bigger (the two never add up) and the use went back to the code.
   */
  applied?: boolean;
}

export interface RemovedPromo {
  code: string;
  reason: PromoProblem;
  at: Date;
}
