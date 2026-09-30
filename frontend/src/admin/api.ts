import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Locale } from '@/i18n/config';
import type { SwatchColor } from '@/lib/swatch';
import { api } from '@/services/api/client';
import { LIVE } from '@/services/queries';
import type {
  AppointmentStatus,
  BookingPhoto,
  Category,
  FeedbackKind,
  FeedbackRating,
  GeoPoint,
  I18nText,
  NailShape,
  Role,
  Service,
  ServiceArt,
  StaffAppointment,
} from '@/types/api';

/*
 * Staff API. This module is only imported from src/admin, which loads on demand for staff,
 * so clients never download it and the installed app never precaches it.
 * Shapes mirror backend/src/modules/admin/*.
 */

const query = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface ManagedDefault {
  /** Came from the studio's default price list (can be reset to it). */
  isDefault: boolean;
  /** A placeholder from the very first starter list, retired by a price-list update. */
  isLegacy: boolean;
  /** Fields staff changed; a price-list update leaves these alone. */
  customized: string[];
}
export interface AdminCategory extends Category, ManagedDefault {
  order: number;
  isActive: boolean;
}
export interface AdminService extends Service, ManagedDefault {
  order: number;
  isActive: boolean;
}
export interface ServiceInput {
  categoryId: string;
  name: I18nText;
  description: I18nText;
  details: I18nText;
  durationMin: number;
  price: number;
  priceFrom: boolean;
  art: ServiceArt;
  isPopular: boolean;
  isActive: boolean;
}
export interface CategoryInput {
  name: I18nText;
  description: I18nText | null;
  singleChoice: boolean;
  color: SwatchColor;
  isActive: boolean;
}

/**
 * An appointment as the dashboard and a client's history return it: the same as a calendar
 * entry but without the per-client visit and no-show counters.
 */
export type StaffAppointmentCore = Omit<StaffAppointment, 'clientStats'>;

/** The booking requests waiting for the signed-in staff member's answer. */
export interface PendingRequests {
  /** The one waiting longest first. */
  appointments: StaffAppointment[];
  total: number;
  /** 'own': a master's own requests; 'all': the whole studio's (the owner, the desk). */
  scope: 'all' | 'own';
}

export interface AppointmentsParams {
  /** First day (YYYY-MM-DD, studio time). */
  from: string;
  /** Last day, inclusive; at most 62 days after `from`. */
  to?: string;
  status?: AppointmentStatus;
  staffId?: string;
  clientId?: string;
}

export interface ClientSummary {
  id: string;
  name: string;
  surname: string;
  /** null for walk-ins booked without an email. */
  email: string | null;
  phone: string | null;
  locale: Locale;
  isActive: boolean;
  bookingBlocked: boolean;
  /** Signs in with a password or Google; false for walk-ins the studio created. */
  hasAccount: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface ClientListItem extends ClientSummary {
  stats: { visits: number; noShows: number; upcoming: number; lastVisit: string | null; spent: number };
}
export interface ClientDetail {
  client: ClientSummary & { notes: string };
  stats: { visits: number; noShows: number; cancelled: number; spent: number };
  /** Newest first, at most 100. */
  appointments: StaffAppointmentCore[];
}
export interface ClientInput {
  name: string;
  surname: string;
  phone: string;
  email?: string;
  notes?: string;
}
export interface ClientPatch {
  name?: string;
  surname?: string;
  phone?: string | null;
  /** Only for walk-ins: clients with their own login manage their email themselves. */
  email?: string;
  notes?: string;
  bookingBlocked?: boolean;
}

export interface DashboardStats {
  date: string;
  today: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    noShow: number;
    expectedRevenue: number;
    /** 0…1: booked minutes over the bookable masters' working minutes. */
    occupancy: number;
    /** Every appointment of the day except cancelled ones, by start time. */
    appointments: StaffAppointmentCore[];
  };
  week: { from: string; appointments: number; completedRevenue: number; expectedRevenue: number };
  pendingApprovals: number;
  next7Days: number;
  newClientsThisMonth: number;
  /** Last 30 days, confirmed and completed visits. */
  topServices: Array<{ id: string; name: I18nText; count: number }>;
  currency: string;
}

export interface TimeInterval {
  start: string;
  end: string;
}
/** Monday … Sunday; each day has up to four intervals, an empty day is a day off. */
export type WeeklyHours = TimeInterval[][];

export interface StaffInput {
  name: string;
  title: I18nText;
  color: SwatchColor;
  userId: string | null;
  /** null = does every service. */
  serviceIds: string[] | null;
  weekly: WeeklyHours;
  /** Missing from an older API: weekly hours, 2-hour sessions. */
  scheduleMode?: ScheduleMode;
  sessionMin?: number;
  isActive: boolean;
  isBookable: boolean;
}
export interface AdminStaff extends StaffInput {
  id: string;
  order: number;
  /** Minutes kept free after each client (the master sets it in My schedule); missing = 0. */
  bufferMin?: number;
}

/**
 * How clients book a master: inside the weekly hours, or only on the days the master opens one
 * by one (WorkDay), in sessions of `sessionMin`.
 */
export type ScheduleMode = 'weekly' | 'days';

/** A day a master opened in working-days mode. */
export interface WorkDay {
  id: string;
  staffId: string;
  /** YYYY-MM-DD, studio time. */
  date: string;
  /** HH:mm, in order: when each booking of the day can start (one client each). */
  times: string[];
  /** Bookings on the day, whoever made them (cancelled ones aside). */
  booked: number;
}

/** A booking photo in the owner's Photos list: who sent it and the booking it is on. */
export interface AdminPhoto extends BookingPhoto {
  client: { id: string; name: string };
  appointment: { id: string; code: string; start: string; status: AppointmentStatus } | null;
}

export interface PhotoStorage {
  /** Bytes of every photo kept (photos and thumbnails), and how many. */
  bytes: number;
  count: number;
  /** Past this the owner is told to delete some. */
  alertBytes: number;
  /** What the server has in all. */
  quotaBytes: number;
}

export interface PhotosParams {
  from?: string;
  to?: string;
  /** Only photos at least this big (KB). */
  minKb?: number;
  sort?: 'newest' | 'oldest' | 'largest';
  page?: number;
}

/** A master's private calendar feed, in the forms the calendar apps take (null = sync is off). */
export interface CalendarFeed {
  /** https: subscribe by URL anywhere, or copy. */
  url: string;
  /** Apple Calendar's "Subscribe" prompt. */
  webcal: string;
  /** Google Calendar's "Add calendar" page. */
  google: string;
  /** Outlook.com's "Subscribe from web". */
  outlook: string;
  createdAt: string;
}

/**
 * The master's own calendars connected directly (instant sync): each booking is written there the
 * moment it changes. `needsReconnect`: the account stopped letting the app in (connect again).
 */
export interface DirectCalendars {
  google: {
    /** Google sign-in is set up on the server (the same Google client connects calendars). */
    available: boolean;
    connected: boolean;
    needsReconnect: boolean;
    /** The Google account connected. */
    email: string | null;
    lastSyncAt: string | null;
  };
  apple: {
    connected: boolean;
    needsReconnect: boolean;
    /** Masked by the server ("al•••@icloud.com"). */
    appleId: string | null;
    lastSyncAt: string | null;
  };
}

/** My schedule → Calendar sync: the subscription link (null = off) and the calendars connected directly. */
export interface CalendarSyncState extends DirectCalendars {
  feed: CalendarFeed | null;
}

export interface WorkDaysInput {
  staffId: string;
  dates: string[];
  times: string[];
}

/** An upcoming booking that the new hours of a master no longer cover (it stays booked). */
export interface OutsideHoursBooking {
  id: string;
  start: string;
  end: string;
  clientName: string;
}

export interface TimeOff {
  id: string;
  /** null = the whole studio is closed. */
  staffId: string | null;
  start: string;
  end: string;
  reason: string;
  createdAt: string;
}
export interface TimeOffInput {
  /** null closes the whole studio (owner only). */
  staffId: string | null;
  /** First and last day (YYYY-MM-DD, studio time). */
  from: string;
  to: string;
  /** Both or neither. Without them the days are off from midnight to midnight. */
  startTime?: string;
  endTime?: string;
  reason: string;
}

export interface StudioSettings {
  name: string;
  legalName: string;
  /** IDNO: 13 digits, or empty. */
  legalId: string;
  tagline: I18nText;
  about: I18nText;
  address: string;
  city: string;
  mapsUrl: string;
  location: GeoPoint;
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
  /** Online booking offers only times that leave no dead gap in a master's day. */
  smartSlots: boolean;
  /** Back to back: at most this many free minutes between two visits. */
  maxGapMin: number;
  /** A gap this long (minutes) still fits another visit, so it is allowed. */
  minBookableGapMin: number;
  /** "Come back" reminders to clients who have not booked since their last visit. */
  rebook: RebookSettings;
}

/** The first come-back reminder, the ones in between (with the loyalty card), the last one. */
export const REBOOK_TONES = ['first', 'nudge', 'last'] as const;
export type RebookTone = (typeof REBOOK_TONES)[number];
/** The studio's own wording; an empty language uses the built-in text. */
export interface RebookText {
  title: I18nText;
  body: I18nText;
}
export interface RebookSettings {
  enabled: boolean;
  /** Days after the last completed visit (14–90). */
  firstAfterDays: number;
  /** Days between the next ones (7–60). */
  repeatEveryDays: number;
  /** In all, the first included (1–5). */
  maxReminders: number;
  channels: { email: boolean; push: boolean };
  texts: Record<RebookTone, RebookText>;
}
/** Any part of the reminders; the API keeps the rest as saved. */
export type RebookPatch = Partial<Omit<RebookSettings, 'channels' | 'texts'>> & {
  channels?: Partial<RebookSettings['channels']>;
  texts?: Partial<Record<RebookTone, RebookText>>;
};
/** The built-in texts, and per language the example values previews are filled with. */
export interface RebookPreview {
  defaults: Record<RebookTone, RebookText>;
  placeholders: string[];
  /** Whether the server can send email / Web Push at all. */
  available: { email: boolean; push: boolean };
  sample: Record<Locale, { name: string; services: string; master: string; loyalty: string | null }>;
}
export interface RebookTestResult {
  email: { to: string; sent: boolean } | null;
  push: { sent: number; devices: number } | null;
}

export interface AdminUser {
  id: string;
  name: string;
  surname: string;
  email: string | null;
  phone: string | null;
  role: Role;
  isActive: boolean;
  hasAccount: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actor: { name: string; surname: string; role: Role } | null;
  targetType: string;
  targetId: string | null;
  meta: Record<string, unknown>;
}

export interface NewAppointmentInput {
  clientId?: string;
  newClient?: { name: string; surname: string; phone: string; email?: string };
  serviceIds: string[];
  /** null = the first free master who does every service. */
  staffId: string | null;
  start: string;
  notes: string;
  status: 'pending' | 'confirmed';
  /** Book even when it overlaps another appointment. */
  force?: boolean;
  /** A promo code the client brings (checked again by the API, one use held). */
  promoCode?: string;
  /** Optional at the desk: the client may not have decided yet. */
  nailShape?: NailShape;
}

export interface Paged {
  total: number;
  page: number;
  pages: number;
}

/** One client's feedback as staff read it (backend/src/modules/feedback). */
export interface AdminFeedback {
  id: string;
  kind: FeedbackKind;
  rating: FeedbackRating | null;
  comment: string;
  createdAt: string;
  updatedAt: string;
  /** null when the account is gone. */
  client: { id: string; name: string; surname: string } | null;
  /** The visit it is about; null for general feedback. */
  visit: { id: string; code: string; start: string; services: I18nText[] } | null;
  master: { id: string; name: string } | null;
}

/** Who reads what: the owner everything, a master their own visits, other staff nothing. */
export type FeedbackScope = 'all' | 'own' | 'none';

export interface FeedbackList extends Paged {
  feedback: AdminFeedback[];
  summary: {
    /** One decimal; null before the first rating. */
    average: number | null;
    /** Ratings the average is made of. */
    count: number;
    byRating: Record<FeedbackRating, number>;
    /** Everything in scope, general feedback without stars included (whatever the filter). */
    total: number;
  };
  scope: FeedbackScope;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
export const adminApi = {
  stats: (date?: string) => api.get<DashboardStats>(`/admin/stats${query({ date })}`),

  appointments: (params: AppointmentsParams) =>
    api.get<{ appointments: StaffAppointment[] }>(`/admin/appointments${query({ ...params })}`).then((r) => r.appointments),
  /** The owner every request; a master only theirs (scoped by the API). */
  pendingRequests: () => api.get<PendingRequests>('/admin/appointments/pending'),
  appointment: (id: string) => api.get<{ appointment: StaffAppointment }>(`/admin/appointments/${id}`).then((r) => r.appointment),
  createAppointment: (input: NewAppointmentInput) =>
    api.post<{ appointment: StaffAppointment }>('/admin/appointments', input).then((r) => r.appointment),
  updateAppointment: (
    id: string,
    input: { status?: AppointmentStatus; staffNotes?: string; notes?: string; cancelReason?: string; force?: boolean; from?: AppointmentStatus },
  ) =>
    api.patch<{ appointment: StaffAppointment }>(`/admin/appointments/${id}`, input).then((r) => r.appointment),
  /** staffId null keeps the current master. */
  rescheduleAppointment: (id: string, input: { start: string; staffId: string | null; force?: boolean }) =>
    api.post<{ appointment: StaffAppointment }>(`/admin/appointments/${id}/reschedule`, input).then((r) => r.appointment),

  clients: (params: { q?: string; page?: number; limit?: number }) =>
    api.get<Paged & { clients: ClientListItem[] }>(`/admin/clients${query(params)}`),
  client: (id: string) => api.get<ClientDetail>(`/admin/clients/${id}`),
  createClient: (input: ClientInput) =>
    api.post<{ client: ClientSummary & { notes: string } }>('/admin/clients', input).then((r) => r.client),
  updateClient: (id: string, input: ClientPatch) =>
    api.patch<{ client: ClientSummary & { notes: string } }>(`/admin/clients/${id}`, input).then((r) => r.client),
  /** A fresh single-use sign-up link (earlier unused links stop working). */
  inviteClient: (id: string) => api.post<{ url: string; expiresAt: string }>(`/admin/clients/${id}/invite`),

  catalog: () => api.get<{ categories: AdminCategory[]; services: AdminService[] }>('/admin/catalog'),
  createService: (input: ServiceInput) => api.post<{ service: AdminService }>('/admin/catalog/services', input).then((r) => r.service),
  updateService: (id: string, input: Partial<ServiceInput>) =>
    api.patch<{ service: AdminService }>(`/admin/catalog/services/${id}`, input).then((r) => r.service),
  resetService: (id: string) => api.post<{ service: AdminService }>(`/admin/catalog/services/${id}/reset`).then((r) => r.service),
  deleteService: (id: string) => api.delete<{ ok: true; archived: boolean }>(`/admin/catalog/services/${id}`),
  createCategory: (input: CategoryInput) => api.post<{ category: AdminCategory }>('/admin/catalog/categories', input).then((r) => r.category),
  updateCategory: (id: string, input: Partial<CategoryInput>) =>
    api.patch<{ category: AdminCategory }>(`/admin/catalog/categories/${id}`, input).then((r) => r.category),
  resetCategory: (id: string) => api.post<{ category: AdminCategory }>(`/admin/catalog/categories/${id}/reset`).then((r) => r.category),
  deleteCategory: (id: string) => api.delete<{ ok: true }>(`/admin/catalog/categories/${id}`),
  reorder: (type: 'category' | 'service', ids: string[]) => api.post<{ ok: true }>('/admin/catalog/reorder', { type, ids }),

  staff: () => api.get<{ staff: AdminStaff[] }>('/admin/team/staff').then((r) => r.staff),
  /** Owner only. */
  updateStaff: (id: string, input: Partial<StaffInput>) => api.patch<{ staff: AdminStaff }>(`/admin/team/staff/${id}`, input).then((r) => r.staff),
  /** Owner only. */
  createStaff: (input: StaffInput) => api.post<{ staff: AdminStaff }>('/admin/team/staff', input).then((r) => r.staff),
  /** Time off overlapping [from, to]; without `to`, the 90 days from `from`. */
  timeOff: (params: { from: string; to?: string }) => api.get<{ timeOff: TimeOff[] }>(`/admin/team/time-off${query(params)}`).then((r) => r.timeOff),
  createTimeOff: (input: TimeOffInput) => api.post<{ timeOff: TimeOff }>('/admin/team/time-off', input).then((r) => r.timeOff),
  deleteTimeOff: (id: string) => api.delete<{ ok: true }>(`/admin/team/time-off/${id}`),
  /** The master profile of the signed-in staff member (404 when they are not a master). */
  myStaff: () => api.get<{ staff: AdminStaff }>('/admin/team/me').then((r) => r.staff),
  updateMyStaff: (input: { weekly?: WeeklyHours; bufferMin?: number; scheduleMode?: ScheduleMode; sessionMin?: number }) =>
    api.patch<{ staff: AdminStaff; outsideHours: OutsideHoursBooking[] }>('/admin/team/me', input),
  /** Owner only: every booking photo, with filters, and how much room they take. */
  photos: (params: PhotosParams) =>
    api.get<Paged & { photos: AdminPhoto[]; storage: PhotoStorage }>(`/admin/photos${query({ ...params })}`),
  /** Owner only: deletes photos (at most 100 at a time). */
  deletePhotos: (ids: string[]) => api.post<{ deleted: number }>('/admin/photos/delete', { ids }),
  /** The signed-in master's calendar sync: the subscription link and the calendars connected directly. */
  calendarSync: () => api.get<CalendarSyncState>('/admin/team/me/calendar'),
  /** Turns the subscription link on, or replaces it (the old one stops working). */
  createCalendarFeed: () => api.post<CalendarSyncState>('/admin/team/me/calendar'),
  deleteCalendarFeed: () => api.delete<CalendarSyncState>('/admin/team/me/calendar'),
  /** Google Calendar: the address of Google's consent screen; Google then comes back to My schedule (?calendar=…). */
  connectGoogleCalendar: () => api.post<{ url: string }>('/admin/team/me/calendar/google').then((r) => r.url),
  /** Deletes the app's calendar in the Google account and forgets the account. */
  disconnectGoogleCalendar: () => api.delete<CalendarSyncState>('/admin/team/me/calendar/google'),
  /** Apple Calendar (iCloud), checked with Apple at once: CALENDAR_AUTH = Apple refused them, CALENDAR_UNREACHABLE = try again. */
  connectAppleCalendar: (input: { appleId: string; password: string }) => api.post<CalendarSyncState>('/admin/team/me/calendar/apple', input),
  disconnectAppleCalendar: () => api.delete<CalendarSyncState>('/admin/team/me/calendar/apple'),
  /** Writes every booking to the connected calendars again (in the background). */
  syncCalendarsNow: () => api.post<CalendarSyncState>('/admin/team/me/calendar/sync'),
  /** Opened days from `from` to `to` (the 90 days from `from` without it), every master's or one's. */
  workDays: (params: { from: string; to?: string; staffId?: string }) =>
    api.get<{ workDays: WorkDay[] }>(`/admin/team/work-days${query(params)}`).then((r) => r.workDays),
  /** Opens days (or changes open ones) with the same start times. The master or the owner. */
  saveWorkDays: (input: WorkDaysInput) =>
    api.put<{ workDays: WorkDay[]; outsideHours: OutsideHoursBooking[] }>('/admin/team/work-days', input),
  /** Closes a day; its bookings stay booked (listed in `outsideHours`). */
  deleteWorkDay: (id: string) => api.delete<{ ok: true; outsideHours: OutsideHoursBooking[] }>(`/admin/team/work-days/${id}`),

  settings: () => api.get<{ settings: StudioSettings }>('/admin/settings').then((r) => r.settings),
  /** Owner only; send just the fields that changed. */
  updateSettings: (input: Partial<StudioSettings>) => api.patch<{ settings: StudioSettings }>('/admin/settings', input).then((r) => r.settings),
  /** Owner only: the parts of the come-back reminders that changed. */
  updateRebook: (patch: RebookPatch) => api.patch<{ settings: StudioSettings }>('/admin/settings', { rebook: patch }).then((r) => r.settings),
  /** Come-back reminders: built-in texts and example values for the previews. */
  rebook: () => api.get<RebookPreview>('/admin/settings/rebook'),
  /** Owner only: the first come-back reminder, sent to the signed-in owner as clients would get it. */
  rebookTest: () => api.post<RebookTestResult>('/admin/settings/rebook/test'),

  users: (params: { q?: string; role?: Role; page?: number; limit?: number }) =>
    api.get<Paged & { users: AdminUser[] }>(`/admin/users${query(params)}`),
  updateUser: (id: string, input: { role?: Role; isActive?: boolean }) =>
    api.patch<{ user: AdminUser }>(`/admin/users/${id}`, input).then((r) => r.user),
  /** Newest first; at most 200. */
  audit: (limit = 100) => api.get<{ logs: AuditEntry[] }>(`/admin/audit${query({ limit })}`).then((r) => r.logs),

  /** Newest first, 20 a page; `rating` keeps one rating (the summary stays the whole list's). */
  feedback: (params: { page?: number; rating?: FeedbackRating | null }) =>
    api.get<FeedbackList>(`/admin/feedback${query(params)}`),
};

export const adminQueries = {
  stats: (date?: string) => queryOptions({ queryKey: ['admin', 'stats', date ?? 'today'], queryFn: () => adminApi.stats(date), staleTime: 30_000 }),
  catalog: () => queryOptions({ queryKey: ['admin', 'catalog'], queryFn: adminApi.catalog, staleTime: 60_000 }),
  staff: () => queryOptions({ queryKey: ['admin', 'staff'], queryFn: adminApi.staff, staleTime: 60_000 }),
  myStaff: () => queryOptions({ queryKey: ['admin', 'staff', 'me'], queryFn: adminApi.myStaff, staleTime: 60_000, retry: false }),
  appointments: (params: AppointmentsParams) =>
    queryOptions({ queryKey: ['admin', 'appointments', params], queryFn: () => adminApi.appointments(params), staleTime: 15_000, ...LIVE }),
  /** Under ['admin', 'appointments'], so every booking change refreshes it too. */
  pendingRequests: () =>
    queryOptions({ queryKey: ['admin', 'appointments', 'pending'], queryFn: adminApi.pendingRequests, staleTime: 15_000, ...LIVE }),
  appointment: (id: string) =>
    queryOptions({ queryKey: ['admin', 'appointment', id], queryFn: () => adminApi.appointment(id), staleTime: 15_000, ...LIVE }),
  clients: (params: { q?: string; page?: number; limit?: number }) =>
    queryOptions({
      queryKey: ['admin', 'clients', params],
      queryFn: () => adminApi.clients(params),
      staleTime: 15_000,
      placeholderData: keepPreviousData,
    }),
  client: (id: string) => queryOptions({ queryKey: ['admin', 'client', id], queryFn: () => adminApi.client(id), staleTime: 15_000 }),
  settings: () => queryOptions({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings, staleTime: 60_000 }),
  rebook: () => queryOptions({ queryKey: ['admin', 'settings', 'rebook'], queryFn: adminApi.rebook, staleTime: 60_000 }),
  timeOff: (params: { from: string; to?: string }) =>
    queryOptions({ queryKey: ['admin', 'time-off', params], queryFn: () => adminApi.timeOff(params), staleTime: 60_000 }),
  photos: (params: PhotosParams) =>
    queryOptions({ queryKey: ['admin', 'photos', params], queryFn: () => adminApi.photos(params), staleTime: 30_000, placeholderData: keepPreviousData }),
  calendarSync: () => queryOptions({ queryKey: ['admin', 'staff', 'me', 'calendar'], queryFn: adminApi.calendarSync, staleTime: 5 * 60_000 }),
  workDays: (params: { from: string; to?: string; staffId?: string }) =>
    queryOptions({ queryKey: ['admin', 'work-days', params], queryFn: () => adminApi.workDays(params), staleTime: 30_000 }),
  users: (params: { q?: string; role?: Role; page?: number }) =>
    queryOptions({
      queryKey: ['admin', 'users', params],
      queryFn: () => adminApi.users(params),
      staleTime: 15_000,
      placeholderData: keepPreviousData,
    }),
  audit: (limit = 200) => queryOptions({ queryKey: ['admin', 'audit', limit], queryFn: () => adminApi.audit(limit), staleTime: 30_000 }),
  feedback: (params: { page?: number; rating?: FeedbackRating | null }) =>
    queryOptions({
      queryKey: ['admin', 'feedback', params],
      queryFn: () => adminApi.feedback(params),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }),
};
