import type { TFunction } from 'i18next';
import { ApiError } from '@/services/api/client';

/** Human message for any thrown error (API codes are translated in common:errors.codes). */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t('common:errors.network');
    return t(`common:errors.codes.${error.code}`, { defaultValue: t('common:errors.generic') });
  }
  return t('common:errors.generic');
}

/** Field-level messages from a 422 (`fields: { email: 'taken' }`). */
export function fieldErrors(t: TFunction, error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [field, code] of Object.entries(error.fields)) {
    out[field] = t(`common:validation.${code}`, { defaultValue: t('common:validation.invalid') });
  }
  return out;
}
