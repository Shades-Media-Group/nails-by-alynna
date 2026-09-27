/** Lower-case, accent-free text for simple contains-search (works for ro/ru/en). */
export function searchable(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export function truncate(input: string | null | undefined, max: number): string {
  if (!input) return '';
  return input.length > max ? input.slice(0, max) : input;
}

/** Keeps only the network part of an IP for session metadata (privacy by default). */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '';
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : '';
}

/** Search text for a person: names, real email and phone written the ways people type it. */
export function userSearch(
  name: string,
  surname: string,
  email: string | null | undefined,
  phone: string | null | undefined,
): string {
  const variants: string[] = [];
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    variants.push(digits);
    if (digits.startsWith('373') && digits.length === 11) variants.push(`0${digits.slice(3)}`);
  }
  const realEmail = email && !email.endsWith('@no-email.invalid') ? email : '';
  return searchable(name, surname, realEmail, ...variants);
}

/** Normalises a search query the same way (digits typed with spaces or a + still match). */
export function searchQuery(input: string): string {
  return searchable(input)
    .replace(/(?<=\d)[\s-]+(?=\d)/g, '')
    .replace(/^\+/, '');
}

/** A space that never ends a line: the words on both sides move to the next line together. */
export const NBSP = '\u00a0';

/**
 * A short token: a number ("1", "6.", "15%", "−30%", "14:00", "3D") or a word of at most three
 * letters ("gel", "din", "из", "QR"), punctuation around it aside.
 */
const SHORT_TOKEN = /^[("«„'“]*(?:[−+-]?\p{N}[\p{N}.,:/%]*\p{L}{0,2}|\p{L}{1,3})[)»"'”.,:;!?…]*$/u;
const LAST_WORD = /^(.*[^ \t\n\r\f])[ \t]+([^ \t\n\r\f]+)(\s*)$/su;
/** A number and the short word after it ("100 MDL", "15% la"); a short word and the number after it ("din 6"). */
const NUMBER_THEN_SHORT = /(^|[\s(])([−+-]?\p{N}[\p{N}.,:%]*)[ \t](?=\p{L}{1,3}(?:[.,:;!?…)]|\s|$))/gu;
const SHORT_THEN_NUMBER = /(^|[\s(])(\p{L}{1,3})[ \t](?=[−+-]?\p{N})/gu;

/**
 * Keeps short words from standing alone at the edge of a line in an email, the same rule as the
 * app's lib/typography.ts: a short last word stays with the word before it ("Alungire, mărimea
 * 1", "Următoarea ta vizită are −15%"), and a number stays with a short word next to it ("100
 * MDL", "din 6"). Only those spaces become no-break spaces; line breaks in the text stay.
 */
export function noOrphan(text: string): string {
  const bound = text.replace(NUMBER_THEN_SHORT, `$1$2${NBSP}`).replace(SHORT_THEN_NUMBER, `$1$2${NBSP}`);
  const last = LAST_WORD.exec(bound);
  if (!last || !SHORT_TOKEN.test(last[2]!)) return bound;
  return `${last[1]}${NBSP}${last[2]}${last[3]}`;
}
