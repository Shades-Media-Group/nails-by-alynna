/** Web Storage keys, in a module of their own so the build config (splash gate) can read them too. */
export const STORAGE_KEYS = {
  locale: 'nba:locale',
  consent: 'nba:consent',
  installDismissed: 'nba:install-dismissed',
  splashSeen: 'nba:splash-seen',
  bookingDraft: 'nba:booking-draft',
} as const;
