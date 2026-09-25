/** Client-side checks mirroring the API's rules (the server remains the authority). */

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Same normalisation as the backend: local Moldovan numbers become +373…. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;
  if (/^00[1-9]\d{6,14}$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^0\d{8}$/.test(compact)) return `+373${compact.slice(1)}`;
  if (/^[67]\d{7}$/.test(compact)) return `+373${compact}`;
  return null;
}

/** Returns a validation code (common:validation.*) or null when the password is acceptable. */
export function passwordIssue(password: string, email = ''): string | null {
  if (password.trim().length < 8) return 'too_short';
  if (password.length > 128) return 'too_long';
  if (new Set(password).size < 4) return 'too_simple';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'contains_email';
  return null;
}

export function nameIssue(value: string): string | null {
  const v = value.trim();
  if (!v) return 'required';
  if (v.length > 60) return 'too_long';
  if (!/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(v)) return 'invalid_name';
  return null;
}
