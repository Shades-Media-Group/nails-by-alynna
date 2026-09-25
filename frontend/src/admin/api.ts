import { queryOptions } from '@tanstack/react-query';
import type { Locale } from '@/i18n/config';
import type { SwatchColor } from '@/lib/swatch';
import { api } from '@/services/api/client';
import type { AppointmentStatus, Category, I18nText, Role, Service, ServiceArt, StaffAppointment } from '@/types/api';

/*
 * Staff API. This module is only imported from src/admin, which loads on demand for staff,
 * so clients never download it and the installed app never precaches it.
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

export interface ClientSummary {
  id: string;
  name: string;
  surname: string;
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
  appointments: StaffAppointment[];
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
    occupancy: number;
    appointments: StaffAppointment[];
  };
  week: { from: string; appointments: number; completedRevenue: number; expectedRevenue: number };
  pendingApprovals: number;
  next7Days: number;
  newClientsThisMonth: number;
  topServices: Array<{ id: string; name: I18nText; count: number }>;
  currency: string;
}

export interface AdminStaff {
  id: string;
  name: string;
  title: I18nText;
  color: SwatchColor;
  userId: string | null;
  serviceIds: string[] | null;
  weekly: Array<Array<{ start: string; end: string }>>;
  isActive: boolean;
  isBookable: boolean;
  order: number;
}
export interface TimeOff {
  id: string;
  staffId: string | null;
  start: string;
  end: string;
  reason: string;
  createdAt: string;
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
  staffId: string | null;
  start: string;
  notes: string;
  status: 'pending' | 'confirmed';
  force?: boolean;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────
export const adminApi = {
  stats: (date?: string) => api.get<DashboardStats>(`/admin/stats${query({ date })}`),

  appointments: (params: { from: string; to?: string; status?: AppointmentStatus; staffId?: string; clientId?: string }) =>
    api.get<{ appointments: StaffAppointment[] }>(`/admin/appointments${query(params)}`).then((r) => r.appointments),
  appointment: (id: string) => api.get<{ appointment: StaffAppointment }>(`/admin/appointments/${id}`).then((r) => r.appointment),
  createAppointment: (input: NewAppointmentInput) =>
    api.post<{ appointment: StaffAppointment }>('/admin/appointments', input).then((r) => r.appointment),
  updateAppointment: (id: string, input: { status?: AppointmentStatus; staffNotes?: string; notes?: string; cancelReason?: string; force?: boolean }) =>
    api.patch<{ appointment: StaffAppointment }>(`/admin/appointments/${id}`, input).then((r) => r.appointment),
  rescheduleAppointment: (id: string, input: { start: string; staffId: string | null; force?: boolean }) =>
    api.post<{ appointment: StaffAppointment }>(`/admin/appointments/${id}/reschedule`, input).then((r) => r.appointment),

  clients: (params: { q?: string; page?: number; limit?: number }) =>
    api.get<{ clients: ClientListItem[]; total: number; page: number; pages: number }>(`/admin/clients${query(params)}`),
  client: (id: string) => api.get<ClientDetail>(`/admin/clients/${id}`),
  createClient: (input: { name: string; surname: string; phone: string; email?: string; notes?: string }) =>
    api.post<{ client: ClientSummary & { notes: string } }>('/admin/clients', input).then((r) => r.client),
  updateClient: (id: string, input: Partial<{ name: string; surname: string; phone: string | null; email: string; notes: string; bookingBlocked: boolean }>) =>
    api.patch<{ client: ClientSummary & { notes: string } }>(`/admin/clients/${id}`, input).then((r) => r.client),
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
  updateStaff: (id: string, input: Partial<Omit<AdminStaff, 'id' | 'order'>>) =>
    api.patch<{ staff: AdminStaff }>(`/admin/team/staff/${id}`, input).then((r) => r.staff),
  createStaff: (input: Omit<AdminStaff, 'id' | 'order'>) => api.post<{ staff: AdminStaff }>('/admin/team/staff', input).then((r) => r.staff),
  timeOff: (params: { from?: string; to?: string }) => api.get<{ timeOff: TimeOff[] }>(`/admin/team/time-off${query(params)}`).then((r) => r.timeOff),
  createTimeOff: (input: { staffId: string | null; start: string; end: string; reason: string }) =>
    api.post<{ timeOff: TimeOff }>('/admin/team/time-off', input).then((r) => r.timeOff),
  deleteTimeOff: (id: string) => api.delete<{ ok: true }>(`/admin/team/time-off/${id}`),

  settings: () => api.get<{ settings: Record<string, unknown> }>('/admin/settings').then((r) => r.settings),
  updateSettings: (input: Record<string, unknown>) =>
    api.patch<{ settings: Record<string, unknown> }>('/admin/settings', input).then((r) => r.settings),

  users: (params: { q?: string; role?: Role; page?: number }) =>
    api.get<{ users: AdminUser[]; total: number; page: number; pages: number }>(`/admin/users${query(params)}`),
  updateUser: (id: string, input: { role?: Role; isActive?: boolean }) =>
    api.patch<{ user: AdminUser }>(`/admin/users/${id}`, input).then((r) => r.user),
  audit: (limit = 100) => api.get<{ logs: AuditEntry[] }>(`/admin/audit${query({ limit })}`).then((r) => r.logs),
};

export const adminQueries = {
  stats: (date?: string) => queryOptions({ queryKey: ['admin', 'stats', date ?? 'today'], queryFn: () => adminApi.stats(date), staleTime: 30_000 }),
  catalog: () => queryOptions({ queryKey: ['admin', 'catalog'], queryFn: adminApi.catalog, staleTime: 60_000 }),
  staff: () => queryOptions({ queryKey: ['admin', 'staff'], queryFn: adminApi.staff, staleTime: 60_000 }),
  appointments: (params: { from: string; to?: string; status?: AppointmentStatus; staffId?: string; clientId?: string }) =>
    queryOptions({ queryKey: ['admin', 'appointments', params], queryFn: () => adminApi.appointments(params), staleTime: 15_000 }),
  appointment: (id: string) => queryOptions({ queryKey: ['admin', 'appointment', id], queryFn: () => adminApi.appointment(id) }),
  clients: (params: { q?: string; page?: number }) =>
    queryOptions({ queryKey: ['admin', 'clients', params], queryFn: () => adminApi.clients(params), staleTime: 15_000 }),
  client: (id: string) => queryOptions({ queryKey: ['admin', 'client', id], queryFn: () => adminApi.client(id) }),
  settings: () => queryOptions({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings }),
};
