/** Web Storage keys, in a module of their own so the build config (splash gate) can read them too. */
export const STORAGE_KEYS = {
  locale: 'nba:locale',
  consent: 'nba:consent',
  installDismissed: 'nba:install-dismissed',
  splashSeen: 'nba:splash-seen',
  bookingDraft: 'nba:booking-draft',
  /** Prefix: `${pushPrompt}:${userId}` holds when to ask for notifications again (lib/pushPrompt.ts). */
  pushPrompt: 'nba:push-prompt',
  /** Prefix: `${visitStatus}:${userId}` holds how this device last saw each upcoming visit. */
  visitStatus: 'nba:visit-status',
  /** Prefix: `${stamps}:${userId}` holds the loyalty card this device last showed. */
  stamps: 'nba:stamps',
} as const;
