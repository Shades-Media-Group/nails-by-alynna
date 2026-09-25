import type { Locale } from '@/i18n/config';

const EN_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const enRules = new Intl.PluralRules('en', { type: 'ordinal' });

/**
 * "4th" / "a 4-a" / "4-й": the ordinal as it reads in a sentence about a visit ("your 4th
 * visit", "a 4-a vizită", "4-й визит"). Romanian's first is "prima".
 */
export function ordinal(n: number, locale: Locale): string {
  if (locale === 'ro') return n === 1 ? 'prima' : `a ${n}-a`;
  if (locale === 'ru') return `${n}-й`;
  return `${n}${EN_SUFFIX[enRules.select(n)] ?? 'th'}`;
}
