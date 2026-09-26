/*
 * Letters that read the same to Romanian, Russian and English speakers, without the pairs people
 * mix up on a screen or over the phone (O/0, I/1/L, Q, W, X, Y).
 */
const CONSONANTS = 'BCDFGHKMNPRSTVZ';
const VOWELS = 'AEIU';
const DIGITS = '23456789';

/** A random code that is easy to say and type: two syllables and two digits, like "MIRA27". */
export function generatePromoCode(random: () => number = Math.random): string {
  const pick = (set: string) => set[Math.floor(random() * set.length)]!;
  return `${pick(CONSONANTS)}${pick(VOWELS)}${pick(CONSONANTS)}${pick(VOWELS)}${pick(DIGITS)}${pick(DIGITS)}`;
}

/** A code as staff type it: upper-case, without spaces. */
export const cleanPromoCode = (input: string) => input.toUpperCase().replace(/\s+/g, '');

export const PROMO_CODE = /^[A-Z0-9]{3,20}$/;
