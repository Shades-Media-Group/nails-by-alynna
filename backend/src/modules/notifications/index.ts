/**
 * Notifications: reminders before a visit, booking changes made by the studio, and the
 * user's preferences for each (Profile → Notifications), by email and Web Push.
 */
export { notifyBookingChange, notifyUser, type BookingChange } from './booking';
export { deliver, type DeliveryOutcome } from './deliver';
export { DEFAULT_PREFS, resolvePrefs } from './prefs';
export { notificationRoutes } from './routes';
export { runDueNotifications, runNotificationsExclusive, startNotificationScheduler, type TickSummary } from './scheduler';
