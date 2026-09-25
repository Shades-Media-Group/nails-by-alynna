import type { z } from 'zod';

/**
 * Error codes are stable identifiers the frontend translates; messages are for logs
 * and developers only.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'SESSION_REVOKED'
  | 'REFRESH_RACE'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'EMAIL_TAKEN'
  | 'WEAK_PASSWORD'
  | 'WRONG_PASSWORD'
  | 'RESET_TOKEN_INVALID'
  | 'GOOGLE_DISABLED'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_TAKEN'
  | 'BOOKING_LIMIT'
  | 'BOOKING_BLOCKED'
  | 'CANCEL_WINDOW_PASSED'
  | 'INVALID_STATUS'
  | 'LAST_ADMINISTRATOR'
  | 'SELF_ACTION'
  | 'IN_USE'
  | 'NOT_A_DEFAULT'
  | 'INVITE_INVALID'
  | 'ALREADY_REGISTERED'
  | 'ONE_PER_CATEGORY'
  | 'CARD_NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEMO_READ_ONLY'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message?: string,
    extra?: { fields?: Record<string, string>; headers?: Record<string, string> },
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = extra?.fields;
    this.headers = extra?.headers;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);

/** Converts a zod error into a 422 with a flat `field.path -> issue code` map. */
export function validationError(error: z.ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return new AppError(422, 'VALIDATION_ERROR', 'Validation failed', { fields });
}

/** MongoDB duplicate-key error (unique index violation). */
export const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;
