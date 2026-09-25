/** Same alphabet as the server (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

/**
 * The member code in whatever was scanned or typed: the card URL (…/c/CODE), the code with
 * spaces or dashes, any letter case. Null when it can't be a member code.
 */
export function normalizeMemberCode(input: string): string | null {
  const fromUrl = /\/c\/([A-Za-z0-9-]+)/.exec(input)?.[1];
  const raw = (fromUrl ?? input).toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

/** "K7QM 2XRP": easier to read out loud and to compare at a glance. */
export const groupMemberCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;
