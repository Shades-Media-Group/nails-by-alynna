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
  /** Creates the account and emails a 6-digit code; `verifyEmail` then signs in. */
  register: (input: RegisterInput) => api.post<{ verification: PendingVerification }>('/auth/register', input).then((r) => r.verification),
  verifyEmail: (input: { email: string; code: string; remember: boolean }) =>
    api.post<{ user: User }>('/auth/verify-email', input).then((r) => r.user),
  resendVerification: (email: string, locale: Locale) => api.post<{ ok: true }>('/auth/verify-email/resend', { email, locale }),
  resetPasswordWithCode: (input: { email: string; code: string; password: string }) =>
    api.post<{ ok: true }>('/auth/reset-password/code', input),
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
  markOnboarded: () => api.post<{ ok: true }>('/me/onboarded'),
  exportUrl: () => '/api/me/export',
  /** Change email, step 1: a code goes to the new address (password when the account has one). */
  startEmailChange: (input: { email: string; password?: string; locale: Locale }) =>
    api.post<{ verification: PendingVerification }>('/me/email', input).then((r) => r.verification),
  resendEmailChange: (email: string, locale: Locale) => api.post<{ ok: true }>('/me/email/resend', { email, locale }),
  confirmEmailChange: (input: { email: string; code: string }) =>
    api.post<{ user: User }>('/me/email/verify', input).then((r) => r.user),
};

/** What the "enter the code" screen needs after sign-up, login or an email change. */
export interface PendingVerification {
  email: string;
  /** False when the email with the code could not be sent (the account exists anyway). */
  sent?: boolean;
  expiresInSec: number;
  resendAfterSec: number;
}

export type ReminderLead = 60 | 120 | 1440;
export interface ChannelPrefs {
  email: boolean;
  push: boolean;
}
export interface NotificationPrefs {
  reminders: ChannelPrefs & { enabled: boolean; leadMinutes: ReminderLead[] };
  bookingUpdates: ChannelPrefs;
  /** Staff: a client asked for, booked, moved or cancelled a visit. */
  staffBookings: ChannelPrefs;
  loyalty: ChannelPrefs;
  marketing: ChannelPrefs & { consentAt: string | null };
}
export type NotificationPrefsPatch = {
  [K in keyof NotificationPrefs]?: Partial<Omit<NotificationPrefs[K], 'consentAt'>>;
};
export interface NotificationSettings {
  prefs: NotificationPrefs;
  email: { address: string; available: boolean };
  push: { available: boolean; publicKey: string | null; devices: number };
}
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

/** Profile → Notifications, and this device's Web Push subscription. */
export const notificationsApi = {
  get: () => api.get<NotificationSettings>('/notifications'),
  update: (patch: NotificationPrefsPatch) => api.patch<{ prefs: NotificationPrefs }>('/notifications/prefs', patch).then((r) => r.prefs),
  publicKey: () => api.get<{ publicKey: string | null }>('/notifications/push/key').then((r) => r.publicKey),
  subscribe: (subscription: PushSubscriptionInput) => api.post<{ ok: true }>('/notifications/push/subscribe', subscription),
  unsubscribe: (endpoint: string) => api.post<{ ok: true }>('/notifications/push/unsubscribe', { endpoint }),
  test: () => api.post<{ sent: number; devices: number }>('/notifications/push/test'),
};

export const availabilityApi = {
  /** `exclude`: the booking being moved, whose own time counts as free. */
  days: (params: { serviceIds: string[]; staffId?: string | null; from?: string; days?: number; exclude?: string | null }) =>
    api.get<AvailabilityDays>(
      `/availability/days${query({ serviceIds: params.serviceIds.join(','), staffId: params.staffId ?? 'any', from: params.from, days: params.days, exclude: params.exclude })}`,
    ),
  slots: (params: { serviceIds: string[]; staffId?: string | null; date: string; exclude?: string | null }) =>
    api.get<{ date: string; durationMin: number; slots: Slot[] }>(
      `/availability/slots${query({ serviceIds: params.serviceIds.join(','), staffId: params.staffId ?? 'any', date: params.date, exclude: params.exclude })}`,
    ),
};

export const appointmentsApi = {
  list: (scope: 'upcoming' | 'past') =>
    api.get<{ appointments: Appointment[] }>(`/appointments${query({ scope })}`).then((r) => r.appointments),
  get: (id: string) => api.get<{ appointment: Appointment }>(`/appointments/${id}`).then((r) => r.appointment),
  /** `promoCode`: a code checked on the confirm step; the API checks it again and holds one use. */
  create: (input: { serviceIds: string[]; staffId: string | null; start: string; notes: string; phone?: string; promoCode?: string }) =>
    api.post<{ appointment: Appointment }>('/appointments', input).then((r) => r.appointment),
  cancel: (id: string, reason: string) =>
    api.post<{ appointment: Appointment }>(`/appointments/${id}/cancel`, { reason }).then((r) => r.appointment),
  reschedule: (id: string, start: string, staffId: string | null) =>
    api.post<{ appointment: Appointment }>(`/appointments/${id}/reschedule`, { start, staffId }).then((r) => r.appointment),
};
