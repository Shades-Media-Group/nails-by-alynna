import type { I18nText, ServiceArt, SwatchColor, WeeklyHours } from '../db/types';

/**
 * Starter catalog. Names, descriptions and prices are placeholders for the studio to edit
 * in Admin → Services; nothing here is a published price list.
 */

export interface SeedService {
  key: string;
  name: I18nText;
  description: I18nText;
  durationMin: number;
  price: number;
  priceFrom?: boolean;
  art: ServiceArt;
  isPopular?: boolean;
}

export interface SeedCategory {
  key: string;
  name: I18nText;
  color: SwatchColor;
  services: SeedService[];
}

export const SEED_CATALOG: SeedCategory[] = [
  {
    key: 'manicure',
    color: 'blush',
    name: { ro: 'Manichiură', ru: 'Маникюр', en: 'Manicure' },
    services: [
      {
        key: 'manicure-classic',
        art: 'care',
        durationMin: 45,
        price: 200,
        name: { ro: 'Manichiură clasică', ru: 'Классический маникюр', en: 'Classic manicure' },
        description: {
          ro: 'Forma unghiilor, îngrijirea cuticulelor și hidratare. Fără ojă.',
          ru: 'Форма ногтей, обработка кутикулы и увлажнение. Без покрытия.',
          en: 'Nail shaping, cuticle care and hydration. No polish.',
        },
      },
      {
        key: 'manicure-gel',
        art: 'gel',
        durationMin: 90,
        price: 350,
        isPopular: true,
        name: {
          ro: 'Manichiură cu ojă semipermanentă',
          ru: 'Маникюр с покрытием гель-лак',
          en: 'Gel polish manicure',
        },
        description: {
          ro: 'Manichiură completă și ojă semipermanentă într-o singură culoare, cu luciu care rezistă până la trei săptămâni.',
          ru: 'Полный маникюр и однотонное покрытие гель-лаком с блеском до трёх недель.',
          en: 'Full manicure with a single-colour gel polish that keeps its shine for up to three weeks.',
        },
      },
      {
        key: 'manicure-strengthening',
        art: 'gel',
        durationMin: 105,
        price: 420,
        name: {
          ro: 'Manichiură cu întărire gel',
          ru: 'Маникюр с укреплением гелем',
          en: 'Gel strengthening manicure',
        },
        description: {
          ro: 'Un strat de gel pe unghia naturală pentru rezistență, apoi culoarea preferată.',
          ru: 'Укрепление натуральных ногтей гелем и покрытие любимым цветом.',
          en: 'A gel layer on the natural nail for strength, then your favourite colour.',
        },
      },
      {
        key: 'manicure-french',
        art: 'french',
        durationMin: 105,
        price: 400,
        name: { ro: 'Manichiură French', ru: 'Френч-маникюр', en: 'French manicure' },
        description: {
          ro: 'French clasic sau colorat, cu linia zâmbetului trasată de mână.',
          ru: 'Классический или цветной френч с аккуратной линией улыбки, нарисованной вручную.',
          en: 'Classic or colourful French with a hand-drawn smile line.',
        },
      },
    ],
  },
  {
    key: 'extensions',
    color: 'lilac',
    name: { ro: 'Extensii', ru: 'Наращивание', en: 'Extensions' },
    services: [
      {
        key: 'extensions-gel',
        art: 'extension',
        durationMin: 150,
        price: 600,
        isPopular: true,
        name: { ro: 'Extensii cu gel', ru: 'Наращивание гелем', en: 'Gel extensions' },
        description: {
          ro: 'Unghii noi, cu lungimea și forma alese de tine, plus acoperire într-o singură culoare.',
          ru: 'Новые ногти нужной длины и формы с однотонным покрытием.',
          en: 'A new set in the length and shape you choose, with single-colour polish.',
        },
      },
      {
        key: 'extensions-long',
        art: 'extension',
        durationMin: 180,
        price: 700,
        priceFrom: true,
        name: { ro: 'Extensii lungi', ru: 'Длинное наращивание', en: 'Long extensions' },
        description: {
          ro: 'Lungimi de la M în sus, forme migdală, stiletto sau coffin. Prețul final depinde de lungime.',
          ru: 'Длина от M и больше, формы миндаль, стилет или балерина. Итоговая цена зависит от длины.',
          en: 'Length M and up in almond, stiletto or coffin shape. Final price depends on length.',
        },
      },
      {
        key: 'extensions-refill',
        art: 'extension',
        durationMin: 120,
        price: 500,
        name: { ro: 'Corecție extensii', ru: 'Коррекция наращивания', en: 'Extension refill' },
        description: {
          ro: 'Umplerea zonei crescute, reechilibrarea formei și culoare nouă.',
          ru: 'Заполнение отросшей зоны, выравнивание формы и новое покрытие.',
          en: 'Fill-in of the regrowth, rebalanced shape and fresh colour.',
        },
      },
    ],
  },
  {
    key: 'pedicure',
    color: 'cyan',
    name: { ro: 'Pedichiură', ru: 'Педикюр', en: 'Pedicure' },
    services: [
      {
        key: 'pedicure-classic',
        art: 'pedicure',
        durationMin: 60,
        price: 300,
        name: { ro: 'Pedichiură clasică', ru: 'Классический педикюр', en: 'Classic pedicure' },
        description: {
          ro: 'Îngrijirea tălpilor și a unghiilor, cuticule și hidratare. Fără ojă.',
          ru: 'Обработка стоп и ногтей, кутикула и увлажнение. Без покрытия.',
          en: 'Feet and nail care, cuticles and hydration. No polish.',
        },
      },
      {
        key: 'pedicure-gel',
        art: 'pedicure',
        durationMin: 90,
        price: 400,
        isPopular: true,
        name: {
          ro: 'Pedichiură cu ojă semipermanentă',
          ru: 'Педикюр с покрытием гель-лак',
          en: 'Gel polish pedicure',
        },
        description: {
          ro: 'Pedichiură completă și ojă semipermanentă cu luciu de lungă durată.',
          ru: 'Полный педикюр и стойкое покрытие гель-лаком.',
          en: 'Full pedicure with long-lasting gel polish.',
        },
      },
    ],
  },
  {
    key: 'nail-art',
    color: 'peach',
    name: { ro: 'Design', ru: 'Дизайн', en: 'Nail art' },
    services: [
      {
        key: 'art-simple',
        art: 'design',
        durationMin: 15,
        price: 50,
        name: { ro: 'Design simplu', ru: 'Простой дизайн', en: 'Simple nail art' },
        description: {
          ro: 'Linii, puncte, folie sau sclipici pe câteva unghii.',
          ru: 'Линии, точки, фольга или блёстки на нескольких ногтях.',
          en: 'Lines, dots, foil or glitter on a few nails.',
        },
      },
      {
        key: 'art-painted',
        art: 'design',
        durationMin: 30,
        price: 100,
        priceFrom: true,
        name: { ro: 'Pictură pe unghii', ru: 'Роспись ногтей', en: 'Hand-painted art' },
        description: {
          ro: 'Desen realizat de mână, după ideea sau poza ta. Prețul depinde de complexitate.',
          ru: 'Ручная роспись по вашей идее или фото. Цена зависит от сложности.',
          en: 'Hand-drawn art from your idea or photo. Price depends on complexity.',
        },
      },
      {
        key: 'art-crystals',
        art: 'design',
        durationMin: 15,
        price: 30,
        priceFrom: true,
        name: { ro: 'Cristale și decor', ru: 'Стразы и декор', en: 'Crystals & decor' },
        description: {
          ro: 'Cristale, perle sau decor 3D pentru un accent strălucitor.',
          ru: 'Стразы, жемчуг или 3D-декор для яркого акцента.',
          en: 'Crystals, pearls or 3D decor for a sparkling accent.',
        },
      },
    ],
  },
  {
    key: 'care',
    color: 'mint',
    name: { ro: 'Îngrijire și îndepărtare', ru: 'Уход и снятие', en: 'Care & removal' },
    services: [
      {
        key: 'removal-gel',
        art: 'removal',
        durationMin: 20,
        price: 80,
        name: {
          ro: 'Îndepărtare ojă semipermanentă',
          ru: 'Снятие гель-лака',
          en: 'Gel polish removal',
        },
        description: {
          ro: 'Îndepărtare delicată, fără a deteriora unghia naturală.',
          ru: 'Бережное снятие без повреждения натуральной ногтевой пластины.',
          en: 'Gentle removal that keeps the natural nail healthy.',
        },
      },
      {
        key: 'removal-extensions',
        art: 'removal',
        durationMin: 30,
        price: 150,
        name: { ro: 'Îndepărtare extensii', ru: 'Снятие наращивания', en: 'Extension removal' },
        description: {
          ro: 'Îndepărtarea completă a extensiilor și îngrijirea unghiei naturale.',
          ru: 'Полное снятие наращенных ногтей и уход за натуральными.',
          en: 'Complete removal of extensions with care for the natural nail.',
        },
      },
      {
        key: 'care-paraffin',
        art: 'care',
        durationMin: 20,
        price: 120,
        name: {
          ro: 'Parafinoterapie pentru mâini',
          ru: 'Парафинотерапия для рук',
          en: 'Paraffin hand treatment',
        },
        description: {
          ro: 'Tratament cald cu parafină pentru piele fină și catifelată.',
          ru: 'Тёплая парафиновая процедура для мягкой и бархатистой кожи.',
          en: 'A warm paraffin treatment for soft, smooth skin.',
        },
      },
    ],
  },
];

const WORKDAY = [{ start: '10:00', end: '19:00' }];
/** Mon–Fri 10–19, Sat 10–16, Sunday off. */
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
