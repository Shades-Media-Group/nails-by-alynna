import type { LoyaltyReward } from '../../db/types';
import type { Locale } from '../../lib/validation';

/** "a 4-a" / "4-й" / "4th": an ordinal as it reads before "visit" (as in the app's lib/ordinal.ts). */
export function ordinal(n: number, locale: Locale): string {
  if (locale === 'ro') return n === 1 ? 'prima' : `a ${n}-a`;
  if (locale === 'ru') return `${n}-й`;
  const suffix: Record<string, string> = { one: 'st', two: 'nd', few: 'rd' };
  return `${n}${suffix[new Intl.PluralRules('en', { type: 'ordinal' }).select(n)] ?? 'th'}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Rules {
  cycle: number;
  rewards: LoyaltyReward[];
}

/** The words on the passes, in the client's language (the app's own wording, loyalty.json). */
export interface WalletCopy {
  card: string;
  description: (studio: string) => string;
  /** At most 9 characters: Google's limit for the points label. */
  stamps: string;
  member: string;
  next: string;
  nextValue: (reward: { percent: number; visit: number; inVisits: number }) => string;
  how: string;
  howText: (rules: Rules) => string;
  address: string;
  phone: string;
  updated: string;
  app: string;
}

export const WALLET_COPY: Record<Locale, WalletCopy> = {
  ro: {
    card: 'Card de fidelitate',
    description: (studio) => `Cardul de fidelitate ${studio}`,
    stamps: 'Ștampile',
    member: 'Membru',
    next: 'Următoarea reducere',
    nextValue: ({ percent, visit, inVisits }) =>
      inVisits === 1 ? `−${percent}% la următoarea vizită` : `−${percent}% la ${ordinal(visit, 'ro')} vizită`,
    how: 'Cum funcționează',
    howText: ({ cycle, rewards }) =>
      [
        'Fiecare vizită finalizată adaugă o ștampilă.',
        ...rewards.map((r) => `${capitalize(ordinal(r.visit, 'ro'))} vizită de pe fiecare card: −${r.percent}% la acea vizită.`),
        `După vizita ${cycle}, începe un card nou.`,
        'Reducerea se aplică la salon, la prețul acelei vizite.',
        'Ștampilele de aici sunt cele din ziua în care ai adăugat cardul; numărul la zi e mereu în aplicație.',
      ].join('\n'),
    address: 'Adresă',
    phone: 'Telefon',
    updated: 'Actualizat',
    app: 'Aplicația',
  },
  ru: {
    card: 'Карта лояльности',
    description: (studio) => `Карта лояльности ${studio}`,
    stamps: 'Отметки',
    member: 'Участник',
    next: 'Следующая скидка',
    nextValue: ({ percent, visit, inVisits }) =>
      inVisits === 1 ? `−${percent}% на следующий визит` : `−${percent}% на ${ordinal(visit, 'ru')} визит`,
    how: 'Как это работает',
    howText: ({ cycle, rewards }) =>
      [
        'Каждый завершённый визит добавляет отметку.',
        ...rewards.map((r) => `${ordinal(r.visit, 'ru')} визит на каждой карте: −${r.percent}% на этот визит.`),
        `После визита ${cycle} начинается новая карта.`,
        'Скидка применяется в салоне к стоимости этого визита.',
        'Здесь отметки на день, когда вы добавили карту; актуальное число всегда в приложении.',
      ].join('\n'),
    address: 'Адрес',
    phone: 'Телефон',
    updated: 'Обновлено',
    app: 'Приложение',
  },
  en: {
    card: 'Loyalty card',
    description: (studio) => `${studio} loyalty card`,
    stamps: 'Stamps',
    member: 'Member',
    next: 'Next discount',
    nextValue: ({ percent, visit, inVisits }) =>
      inVisits === 1 ? `${percent}% off your next visit` : `${percent}% off the ${ordinal(visit, 'en')} visit`,
    how: 'How it works',
    howText: ({ cycle, rewards }) =>
      [
        'Each completed visit adds a stamp.',
        ...rewards.map((r) => `Your ${ordinal(r.visit, 'en')} visit on each card: ${r.percent}% off that visit.`),
        `After visit ${cycle}, a new card starts.`,
        'The discount is applied at the studio, on the price of that visit.',
        'The stamps here are as of the day you added the card; the app always has the latest count.',
      ].join('\n'),
    address: 'Address',
    phone: 'Phone',
    updated: 'Updated',
    app: 'App',
  },
};
