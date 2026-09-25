import type { ApiErrorBody } from '@/types/api';

/**
 * Fetch wrapper for the same-origin API. Credentials live in httpOnly cookies (never in JS).
 * On 401 it refreshes the session once — single-flight across the tab and, via the Web
 * Locks API, across tabs — then retries the original request.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

const NO_REFRESH = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password']);

type SessionListener = () => void;
const expiredListeners = new Set<SessionListener>();
/** Subscribe to "the session is gone" (refresh failed) — used by the auth provider. */
export function onSessionExpired(listener: SessionListener): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  // 409 = another tab rotated the token a moment ago; our cookies are already fresh.
  return response.ok || response.status === 409;
}

export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const run = () => doRefresh().catch(() => false);
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshing = (locks ? locks.request('nba-session-refresh', run) : run()).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401. */
  noRefresh?: boolean;
}

async function readErrorBody(response: Response): Promise<Partial<ApiErrorBody> | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  const body = await readErrorBody(response);
  const code = body?.error?.code ?? (response.status === 0 ? 'NETWORK' : 'HTTP_' + response.status);
  return new ApiError(response.status, code, body?.error?.message ?? response.statusText, body?.error?.fields ?? {});
}

export async function apiRequest<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    signal: options.signal,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Network error');
  }

  if (response.status === 401 && !options.noRefresh && !NO_REFRESH.has(path)) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(method, path, body, { ...options, noRefresh: true });
    for (const listener of expiredListeners) listener();
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('PATCH', path, body, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('DELETE', path, body, options),
};

/** Non-secret cookie set with the session: lets the app skip /me for signed-out visitors. */
export function hasSessionHint(): boolean {
  return typeof document !== 'undefined' && /(?:^|;\s*)nba_sess=1/.test(document.cookie);
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
