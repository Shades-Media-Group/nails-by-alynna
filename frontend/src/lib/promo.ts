import type { TFunction } from 'i18next';
import { LOCALE_TAGS, type Locale } from '@/i18n/config';
import { ApiError } from '@/services/api/client';
import type { Appointment, PromoKind, PromoProblem } from '@/types/api';
import { dateToInstant, formatPrice } from './format';

/*
 * Promo codes in the app: why a code doesn't apply, in words, and the one discount a visit gets.
 * Promo codes and loyalty discounts never add up; the bigger one wins (the API decides which one
 * a visit gets, see backend/src/modules/promo).
 */

const PROBLEMS: readonly PromoProblem[] = [
  'unknown',
  'inactive',
  'expired',
  'not_started',
  'used_up',
  'used_by_you',
  'first_visit',
  'master',
  'services',
  'min_total',
];

export interface PromoRefusal {
  problem: PromoProblem;
  /** What the message needs: endsAt / startsAt (YYYY-MM-DD), minTotal, master. */
  details: Record<string, string>;
}

/** Why the API refused a code (422 PROMO_INVALID), or null for any other error. */
export function promoRefusal(error: unknown): PromoRefusal | null {
  if (!(error instanceof ApiError) || error.code !== 'PROMO_INVALID') return null;
  const problem = error.fields.promoCode as PromoProblem | undefined;
  return { problem: problem && PROBLEMS.includes(problem) ? problem : 'unknown', details: error.fields };
}

const dayFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "17 June" / "17 iunie" / "17 июня". */
export function formatPromoDay(date: string, locale: Locale): string {
  let f = dayFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: 'numeric', month: 'long', timeZone: 'UTC' });
    dayFormats.set(locale, f);
  }
  return f.format(dateToInstant(date));
}

/**
 * Why a code doesn't apply, in words, with the day, the minimum or the master it needs. `desk`:
 * staff read it for a client at the desk ("this client" instead of "you").
 */
export function promoProblemText(
  t: TFunction,
  refusal: PromoRefusal,
  opts: { locale: Locale; currency: string; desk?: boolean },
): string {
  const { problem, details } = refusal;
  if (opts.desk && (problem === 'used_by_you' || problem === 'first_visit' || problem === 'services')) {
    return t(`promo:problemDesk.${problem}`);
  }
  if (problem === 'expired' && details.endsAt) return t('promo:problem.expired', { date: formatPromoDay(details.endsAt, opts.locale) });
  if (problem === 'not_started' && details.startsAt) {
    return t('promo:problem.not_started', { date: formatPromoDay(details.startsAt, opts.locale) });
  }
  if (problem === 'min_total' && details.minTotal) {
    return t('promo:problem.min_total', { amount: formatPrice(t, Number(details.minTotal), opts.currency) });
  }
  if (problem === 'master') return details.master ? t('promo:problem.master', { name: details.master }) : t('promo:problem.masterOther');
  if (problem === 'expired' || problem === 'not_started' || problem === 'min_total') return t('promo:problem.generic');
  return t(`promo:problem.${problem}`);
}

/** "−20%" or "−50 MDL". */
export function promoValueText(t: TFunction, kind: PromoKind, value: number, currency: string): string {
  return kind === 'percent' ? t('promo:line.percent', { value }) : t('promo:line.amount', { amount: formatPrice(t, value, currency) });
}

/** What a code takes off a visit: "−20% · −66 MDL", or "−50 MDL" for an amount. */
export function promoAmountText(t: TFunction, promo: { kind: PromoKind; value: number; discount: number }, currency: string): string {
  const amount = t('promo:line.amount', { amount: formatPrice(t, promo.discount, currency) });
  return promo.kind === 'percent' ? `${promoValueText(t, promo.kind, promo.value, currency)} · ${amount}` : amount;
}

export interface VisitDiscount {
  source: 'promo' | 'loyalty' | null;
  amount: number;
  /** The list price less the discount, never below zero. */
  pay: number;
}

/** The one discount a visit gets (its promo code or its loyalty discount, never both). */
export function visitDiscount(a: Pick<Appointment, 'totalPrice' | 'loyalty' | 'promo'>): VisitDiscount {
  const amount = a.promo?.applied ? a.promo.discount : a.loyalty && a.loyalty.percent > 0 ? a.loyalty.discount : 0;
  const source = a.promo?.applied ? 'promo' : amount > 0 ? 'loyalty' : null;
  return { source, amount, pay: Math.max(0, a.totalPrice - amount) };
}
