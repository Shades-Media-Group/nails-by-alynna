/** The web build that is running (shown in Profile and the admin System card). */
export const BUILD = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILT_AT__,
} as const;
