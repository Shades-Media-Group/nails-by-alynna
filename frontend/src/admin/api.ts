import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { Locale } from '@/i18n/config';
import type { SwatchColor } from '@/lib/swatch';
import { api } from '@/services/api/client';
import type { AppointmentStatus, Category, I18nText, Role, Service, ServiceArt, StaffAppointment } from '@/types/api';

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
  isActive: boolean;
  isBookable: boolean;
}
export interface AdminStaff extends StaffInput {
  id: string;
  order: number;
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
}

export interface Paged {
  total: number;
  page: number;
  pages: number;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
export const adminApi = {
  stats: (date?: string) => api.get<DashboardStats>(`/admin/stats${query({ date })}`),

  appointments: (params: AppointmentsParams) =>
    api.get<{ appointments: StaffAppointment[] }>(`/admin/appointments${query({ ...params })}`).then((r) => r.appointments),
  appointment: (id: string) => api.get<{ appointment: StaffAppointment }>(`/admin/appointments/${id}`).then((r) => r.appointment),
  createAppointment: (input: NewAppointmentInput) =>
    api.post<{ appointment: StaffAppointment }>('/admin/appointments', input).then((r) => r.appointment),
  updateAppointment: (id: string, input: { status?: AppointmentStatus; staffNotes?: string; notes?: string; cancelReason?: string; force?: boolean }) =>
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

  settings: () => api.get<{ settings: StudioSettings }>('/admin/settings').then((r) => r.settings),
  /** Owner only; send just the fields that changed. */
  updateSettings: (input: Partial<StudioSettings>) => api.patch<{ settings: StudioSettings }>('/admin/settings', input).then((r) => r.settings),

  users: (params: { q?: string; role?: Role; page?: number; limit?: number }) =>
    api.get<Paged & { users: AdminUser[] }>(`/admin/users${query(params)}`),
  updateUser: (id: string, input: { role?: Role; isActive?: boolean }) =>
    api.patch<{ user: AdminUser }>(`/admin/users/${id}`, input).then((r) => r.user),
  /** Newest first; at most 200. */
  audit: (limit = 100) => api.get<{ logs: AuditEntry[] }>(`/admin/audit${query({ limit })}`).then((r) => r.logs),
};

export const adminQueries = {
  stats: (date?: string) => queryOptions({ queryKey: ['admin', 'stats', date ?? 'today'], queryFn: () => adminApi.stats(date), staleTime: 30_000 }),
  catalog: () => queryOptions({ queryKey: ['admin', 'catalog'], queryFn: adminApi.catalog, staleTime: 60_000 }),
  staff: () => queryOptions({ queryKey: ['admin', 'staff'], queryFn: adminApi.staff, staleTime: 60_000 }),
  appointments: (params: AppointmentsParams) =>
    queryOptions({ queryKey: ['admin', 'appointments', params], queryFn: () => adminApi.appointments(params), staleTime: 15_000 }),
  appointment: (id: string) => queryOptions({ queryKey: ['admin', 'appointment', id], queryFn: () => adminApi.appointment(id), staleTime: 15_000 }),
  clients: (params: { q?: string; page?: number; limit?: number }) =>
    queryOptions({
      queryKey: ['admin', 'clients', params],
      queryFn: () => adminApi.clients(params),
      staleTime: 15_000,
      placeholderData: keepPreviousData,
    }),
  client: (id: string) => queryOptions({ queryKey: ['admin', 'client', id], queryFn: () => adminApi.client(id), staleTime: 15_000 }),
  settings: () => queryOptions({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings, staleTime: 60_000 }),
  timeOff: (params: { from: string; to?: string }) =>
    queryOptions({ queryKey: ['admin', 'time-off', params], queryFn: () => adminApi.timeOff(params), staleTime: 60_000 }),
  users: (params: { q?: string; role?: Role; page?: number }) =>
    queryOptions({
      queryKey: ['admin', 'users', params],
      queryFn: () => adminApi.users(params),
      staleTime: 15_000,
      placeholderData: keepPreviousData,
    }),
  audit: (limit = 200) => queryOptions({ queryKey: ['admin', 'audit', limit], queryFn: () => adminApi.audit(limit), staleTime: 30_000 }),
};
