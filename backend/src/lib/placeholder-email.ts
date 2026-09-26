import type { ObjectId } from 'bson';

/**
 * Clients booked in person may have no email; they get a unique address that can never
 * receive mail (the reserved .invalid top-level domain) until they claim their account.
 */
export function placeholderEmail(id: ObjectId): string {
  return `client+${id.toHexString()}@no-email.invalid`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith('@no-email.invalid');
}
