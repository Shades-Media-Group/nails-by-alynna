import type { Locale } from '@/i18n/config';
import type {
  Appointment,
  AvailabilityDays,
  Catalog,
  DeviceSession,
  PublicConfig,
  Slot,
  StaffMember,
  User,
} from '@/types/api';
import { api, query } from './client';

/** Typed client for the public, auth, account and booking endpoints. */

export const publicApi = {
  config: () => api.get<PublicConfig>('/config'),
  catalog: () => api.get<Catalog>('/catalog'),
  staff: () => api.get<{ staff: StaffMember[] }>('/staff').then((r) => r.staff),
};

export interface RegisterInput {
  name: string;
  surname: string;
  email: string;
  phone: string;
  password: string;
  locale: Locale;
  remember: boolean;
  acceptTerms: true;
  /** Token from a studio invite link: the account takes over the walk-in record. */
  invite?: string;
}

export interface InviteInfo {
  name: string;
  surname: string;
  phone: string | null;
  email: string | null;
  locale: Locale;
  nextVisit: string | null;
}

export const authApi = {
  me: () => api.get<{ user: User }>('/auth/me').then((r) => r.user),
  login: (input: { email: string; password: string; remember: boolean }) =>
    api.post<{ user: User }>('/auth/login', input).then((r) => r.user),
  register: (input: RegisterInput) => api.post<{ user: User }>('/auth/register', input).then((r) => r.user),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  demo: (role: 'client' | 'admin' | 'administrator') => api.post<{ user: User }>('/auth/demo', { role }).then((r) => r.user),
  logoutAll: () => api.post<{ ok: true }>('/auth/logout-all'),
  forgotPassword: (email: string, locale: Locale) => api.post<{ ok: true }>('/auth/forgot-password', { email, locale }),
  resetPassword: (token: string, password: string) => api.post<{ ok: true }>('/auth/reset-password', { token, password }),
  sessions: () => api.get<{ sessions: DeviceSession[] }>('/auth/sessions').then((r) => r.sessions),
  revokeSession: (id: string) => api.delete<{ ok: true }>(`/auth/sessions/${id}`),
  googleStartUrl: (locale: Locale, remember: boolean, next?: string, invite?: string) =>
    `/api/auth/google/start${query({ lang: locale, remember: remember ? '1' : '0', next, invite })}`,
  invite: (token: string) => api.get<{ invite: InviteInfo }>(`/auth/invite/${encodeURIComponent(token)}`).then((r) => r.invite),
};

export const meApi = {
  update: (input: Partial<Pick<User, 'name' | 'surname' | 'phone' | 'locale'>>) =>
    api.patch<{ user: User }>('/me', input).then((r) => r.user),
  changePassword: (input: { currentPassword?: string; newPassword: string }) => api.post<{ ok: true }>('/me/password', input),
  deleteAccount: (password?: string) => api.delete<{ ok: true }>('/me', { password }),
  exportUrl: () => '/api/me/export',
};

export const availabilityApi = {
  days: (params: { serviceIds: string[]; staffId?: string | null; from?: string; days?: number }) =>
    api.get<AvailabilityDays>(
      `/availability/days${query({ serviceIds: params.serviceIds.join(','), staffId: params.staffId ?? 'any', from: params.from, days: params.days })}`,
    ),
  slots: (params: { serviceIds: string[]; staffId?: string | null; date: string }) =>
    api.get<{ date: string; durationMin: number; slots: Slot[] }>(
      `/availability/slots${query({ serviceIds: params.serviceIds.join(','), staffId: params.staffId ?? 'any', date: params.date })}`,
    ),
};

export const appointmentsApi = {
  list: (scope: 'upcoming' | 'past') =>
    api.get<{ appointments: Appointment[] }>(`/appointments${query({ scope })}`).then((r) => r.appointments),
  get: (id: string) => api.get<{ appointment: Appointment }>(`/appointments/${id}`).then((r) => r.appointment),
  create: (input: { serviceIds: string[]; staffId: string | null; start: string; notes: string; phone?: string }) =>
    api.post<{ appointment: Appointment }>('/appointments', input).then((r) => r.appointment),
  cancel: (id: string, reason: string) =>
    api.post<{ appointment: Appointment }>(`/appointments/${id}/cancel`, { reason }).then((r) => r.appointment),
  reschedule: (id: string, start: string, staffId: string | null) =>
    api.post<{ appointment: Appointment }>(`/appointments/${id}/reschedule`, { start, staffId }).then((r) => r.appointment),
};
