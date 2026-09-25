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
