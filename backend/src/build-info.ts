/**
 * Build identity, injected at bundle time (esbuild `define` in scripts/build-node.mjs, or
 * `wrangler deploy --define` for the Workers build). Falls back to "dev" when running from
 * source, so /api/health always says exactly which build is live.
 */
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BUILT_AT__: string | undefined;
declare const __APP_CHANGES__: string[] | undefined;

export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'local',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : null,
  changes: typeof __APP_CHANGES__ !== 'undefined' && Array.isArray(__APP_CHANGES__) ? __APP_CHANGES__ : [],
} as const;

export const STARTED_AT = Date.now();

export function runtimeName(): 'workers' | 'node' {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  return ua === 'Cloudflare-Workers' ? 'workers' : 'node';
}
