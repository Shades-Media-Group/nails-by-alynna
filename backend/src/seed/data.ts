import type { I18nText, ServiceArt, SwatchColor, WeeklyHours } from '../db/types';

/**
 * The studio's default catalog: the published Nails by Alynna price list (September 2026).
 * It is applied as "managed defaults" (see ./defaults.ts): new versions update whatever the
 * studio has not edited in Admin → Services, and never touch what it has.
 * Durations are the studio's starting estimates; staff adjust them per service.
 */

export interface DefaultService {
  /** Stable identity across versions; never reuse a key for a different service. */
  key: string;
  name: I18nText;
  description: I18nText;
  durationMin: number;
  price: number;
  /** "from" pricing: the final price depends on the material or the number of nails. */
  priceFrom?: boolean;
  art: ServiceArt;
  isPopular?: boolean;
}

export interface DefaultCategory {
  key: string;
  name: I18nText;
  description?: I18nText;
  /** Options of one thing (lengths): a booking takes at most one service from here. */
  singleChoice?: boolean;
  color: SwatchColor;
  services: DefaultService[];
}

/** Bump whenever DEFAULT_CATALOG changes, so existing databases pick the change up. */
export const CATALOG_DEFAULTS_VERSION = 5;

const SIZE_PRICES = { extension: [400, 450, 500, 550, 600, 650], correction: [370, 420, 470, 520, 570, 620] };
const SIZE_MINUTES = { extension: [120, 130, 140, 150, 165, 180], correction: [105, 115, 125, 135, 150, 165] };

const SIZE_NAMES = {
  extension: { ro: 'Alungire, mărimea', ru: 'Наращивание, размер', en: 'Extensions, size' },
  correction: { ro: 'Corecție, mărimea', ru: 'Коррекция, размер', en: 'Refill, size' },
};

/** What each size means, in words (size = length of the nail). */
function sizeDescription(size: number): I18nText {
  if (size === 1) return { ro: 'Cea mai scurtă lungime.', ru: 'Самая короткая длина.', en: 'The shortest length.' };
  if (size === 6) return { ro: 'Cea mai mare lungime.', ru: 'Самая большая длина.', en: 'The longest length.' };
  return { ro: `Lungimea ${size} din 6.`, ru: `Длина ${size} из 6.`, en: `Length ${size} of 6.` };
}

/**
 * Sizes 1 to 6. Names stand on their own ("Extensions, size 3"), because bookings, calendar
 * entries and the admin show them without the category heading.
 */
function sizes(kind: 'extension' | 'correction', popularSize: number): DefaultService[] {
  const names = SIZE_NAMES[kind];
  return SIZE_PRICES[kind].map((price, index) => {
    const size = index + 1;
    return {
      key: `${kind}-size-${size}`,
      art: kind === 'extension' ? `length-${size as 1 | 2 | 3 | 4 | 5 | 6}` : `refill-${size as 1 | 2 | 3 | 4 | 5 | 6}`,
      price,
      durationMin: SIZE_MINUTES[kind][index]!,
      isPopular: size === popularSize,
      name: { ro: `${names.ro} ${size}`, ru: `${names.ru} ${size}`, en: `${names.en} ${size}` },
      description: sizeDescription(size),
    };
  });
}

export const DEFAULT_CATALOG: DefaultCategory[] = [
  {
    key: 'extension',
    color: 'lilac',
    singleChoice: true,
    name: { ro: 'Alungire', ru: 'Наращивание', en: 'Extensions' },
    description: {
      ro: 'Mărimea arată lungimea: 1 este cea mai scurtă, 6 cea mai lungă. Nu ești sigură? Alege mărimea cea mai apropiată și o stabilim împreună la salon.',
      ru: 'Размер означает длину: 1 самая короткая, 6 самая длинная. Не уверены? Выберите ближайший размер, и мы уточним его вместе в салоне.',
      en: "Size means length: 1 is the shortest, 6 the longest. Not sure? Pick the closest size and we'll settle it together at the studio.",
    },
    services: sizes('extension', 1),
  },
  {
    key: 'correction',
    color: 'blush',
    singleChoice: true,
    name: { ro: 'Corecție', ru: 'Коррекция', en: 'Refill' },
    description: {
      ro: 'Întreținerea alungirii: completăm zona crescută și refacem forma. Mărimile sunt aceleași ca la alungire.',
      ru: 'Уход за наращиванием: заполняем отросшую зону и восстанавливаем форму. Размеры те же, что и при наращивании.',
      en: 'Keeps extensions fresh: we fill the grown-out area and reshape. Sizes match the extension sizes.',
    },
    services: sizes('correction', 1),
  },
  {
    key: 'other',
    color: 'peach',
    name: { ro: 'Altele', ru: 'Другие услуги', en: 'Other services' },
    services: [
      {
        key: 'gel-polish',
        art: 'gel',
        durationMin: 90,
        price: 300,
        isPopular: true,
        name: { ro: 'Acoperire cu lac gel', ru: 'Покрытие гель-лаком', en: 'Gel polish' },
        description: {
          ro: 'Lac gel pe unghiile naturale, într-o culoare la alegere.',
          ru: 'Гель-лак на натуральные ногти, один цвет на выбор.',
          en: 'Gel polish on natural nails, one colour of your choice.',
        },
      },
      {
        key: 'french',
        art: 'french',
        durationMin: 20,
        price: 30,
        name: { ro: 'French', ru: 'Френч', en: 'French tips' },
        description: {
          ro: 'Se adaugă la acoperire sau la alungire.',
          ru: 'Добавляется к покрытию или наращиванию.',
          en: 'Added to gel polish or extensions.',
        },
      },
      {
        key: 'design-complex',
        art: 'design-complex',
        durationMin: 30,
        price: 50,
        name: { ro: 'Design complicat', ru: 'Сложный дизайн', en: 'Complex design' },
        description: {
          ro: 'Design elaborat, adăugat la acoperire sau la alungire.',
          ru: 'Сложный дизайн, добавляется к покрытию или наращиванию.',
          en: 'An elaborate design, added to gel polish or extensions.',
        },
      },
      {
        key: 'design-3d-gel',
        art: 'design-3d',
        durationMin: 15,
        price: 5,
        priceFrom: true,
        name: { ro: 'Design 3D din gel, per unghie', ru: '3D-дизайн гелем, за ноготь', en: '3D gel design, per nail' },
        description: {
          ro: '5 MDL pentru fiecare unghie cu design 3D.',
          ru: '5 MDL за каждый ноготь с 3D-дизайном.',
          en: '5 MDL for each nail with 3D design.',
        },
      },
      {
        key: 'design-extra',
        art: 'design-extra',
        durationMin: 45,
        price: 100,
        name: { ro: 'Design extra', ru: 'Экстра-дизайн', en: 'Extra design' },
        description: {
          ro: 'Pentru seturile cu mult design.',
          ru: 'Для сетов с большим количеством дизайна.',
          en: 'For sets with a lot of design.',
        },
      },
      {
        key: 'removal-foreign',
        art: 'file',
        durationMin: 30,
        price: 50,
        priceFrom: true,
        name: {
          ro: 'Scoaterea materialului străin',
          ru: 'Снятие чужого материала',
          en: "Removing another salon's work",
        },
        description: {
          ro: 'Îndepărtăm materialul aplicat în alt salon: 50 sau 100 MDL, în funcție de material.',
          ru: 'Снимаем материал, нанесённый в другом салоне: 50 или 100 MDL в зависимости от материала.',
          en: 'We remove product applied at another salon: 50 or 100 MDL depending on the material.',
        },
      },
      {
        key: 'removal',
        art: 'removal',
        durationMin: 20,
        price: 50,
        name: { ro: 'Scoatere', ru: 'Снятие', en: 'Removal' },
        description: {
          ro: 'Îndepărtarea lacului gel sau a alungirii.',
          ru: 'Снятие гель-лака или наращивания.',
          en: 'Removal of gel polish or extensions.',
        },
      },
      {
        key: 'hygiene',
        art: 'care',
        durationMin: 30,
        price: 50,
        name: { ro: 'Igienă după scoatere', ru: 'Гигиена после снятия', en: 'Hygienic care after removal' },
        description: {
          ro: 'Se adaugă la scoatere: forma unghiilor și îngrijirea cuticulelor.',
          ru: 'Добавляется к снятию: форма ногтей и обработка кутикулы.',
          en: 'Added to a removal: nail shaping and cuticle care.',
        },
      },
    ],
  },
];

/**
 * Keys of the first starter catalog (placeholders, version 1). Untouched leftovers from it are
 * retired when a database moves to version 2; anything the studio edited stays.
 */
export const LEGACY_CATALOG_KEYS = {
  categories: ['manicure', 'extensions', 'pedicure', 'nail-art', 'care'],
  services: [
    'manicure-classic',
    'manicure-gel',
    'manicure-strengthening',
    'manicure-french',
    'extensions-gel',
    'extensions-long',
    'extensions-refill',
    'pedicure-classic',
    'pedicure-gel',
    'art-simple',
    'art-painted',
    'art-crystals',
    'removal-gel',
    'removal-extensions',
    'care-paraffin',
  ],
};

const WORKDAY = [{ start: '10:00', end: '19:00' }];
/** Monday to Friday 10:00 to 19:00, Saturday 10:00 to 16:00, Sunday off. */
export const DEFAULT_WEEKLY: WeeklyHours = [
  WORKDAY,
  WORKDAY,
  WORKDAY,
  WORKDAY,
  WORKDAY,
  [{ start: '10:00', end: '16:00' }],
  [],
];

export const SEED_MASTER = {
  name: 'Alina',
  title: { ro: 'Nail artist', ru: 'Мастер маникюра', en: 'Nail artist' } satisfies I18nText,
  color: 'blush' as SwatchColor,
};
