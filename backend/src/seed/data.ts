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
  /** "About the procedure" behind ⓘ: what happens, roughly how long, and aftercare or who it suits. */
  details: I18nText;
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
export const CATALOG_DEFAULTS_VERSION = 6;

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

/** Who a length suits: short (1–2), medium (3–4) or long (5–6). */
function lengthSuits(size: number): I18nText {
  if (size <= 2) {
    return {
      ro: 'O lungime discretă, comodă în fiecare zi.',
      ru: 'Сдержанная длина, удобная на каждый день.',
      en: "A subtle length that's easy to wear every day.",
    };
  }
  if (size <= 4) {
    return {
      ro: 'O lungime medie, care se vede, dar se poartă ușor.',
      ru: 'Средняя длина: заметная, но удобная в носке.',
      en: 'A medium length: noticeable, yet easy to wear.',
    };
  }
  return {
    ro: 'O lungime mare, pentru un look îndrăzneț.',
    ru: 'Большая длина для смелого образа.',
    en: 'A long length for a bold look.',
  };
}

/**
 * "About the procedure" for a size: what happens, who it suits or when to come, and how long it
 * lasts. The visit's own time is left out: the sheet shows each size's exact duration above it.
 */
function sizeDetails(kind: 'extension' | 'correction', size: number): I18nText {
  if (kind === 'extension') {
    const suits = lengthSuits(size);
    return {
      ro: `Alungim unghiile la mărimea ${size} și le pilim în forma pe care o alegi la programare. ${suits.ro} Ține de obicei 3–4 săptămâni; apoi vino la corecție, ca unghiile să arate îngrijit.`,
      ru: `Наращиваем ногти до размера ${size} и придаём им форму, которую вы выбираете при записи. ${suits.ru} Обычно держится 3–4 недели; после этого приходите на коррекцию, чтобы ногти выглядели ухоженно.`,
      en: `We extend your nails to size ${size} and file them to the shape you choose when booking. ${suits.en} It usually lasts 3–4 weeks; then come back for a refill to keep them looking neat.`,
    };
  }
  return {
    ro: `Completăm zona crescută și refacem forma, păstrând lungimea mărimii ${size}. Vino la 3–4 săptămâni după alungire sau după corecția anterioară; rezultatul ține de obicei tot atât. Între vizite, poartă mănuși când faci curățenie.`,
    ru: `Заполняем отросшую зону и восстанавливаем форму, сохраняя длину размера ${size}. Приходите через 3–4 недели после наращивания или предыдущей коррекции; результат обычно держится столько же. Между визитами надевайте перчатки для уборки.`,
    en: `We fill the grown-out area and reshape, keeping the size ${size} length. Come 3–4 weeks after your extensions or your last refill; it usually lasts as long again. Between visits, wear gloves when cleaning.`,
  };
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
      details: sizeDetails(kind, size),
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
        details: {
          ro: 'Pregătim unghiile naturale, le pilim în forma aleasă și le acoperim cu lac gel într-o culoare la alegere. Durează aproximativ o oră și jumătate. Acoperirea ține de obicei 2–3 săptămâni; poartă mănuși când folosești detergenți, ca luciul să reziste mai mult.',
          ru: 'Готовим натуральные ногти, придаём им выбранную форму и наносим гель-лак нужного вам цвета. Процедура занимает около полутора часов. Покрытие обычно держится 2–3 недели; надевайте перчатки при работе с бытовой химией, чтобы блеск сохранялся дольше.',
          en: 'We prep your natural nails, file them to your chosen shape and apply gel polish in the colour you like. It takes about an hour and a half. The coat usually lasts 2–3 weeks; wear gloves when using cleaning products to keep the shine longer.',
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
        details: {
          ro: 'Linia albă clasică pe vârful unghiilor. Se face peste acoperire sau alungire, așa că o alegi împreună cu una dintre ele. Adaugă aproximativ 20 de minute și ține cât stratul de sub ea.',
          ru: 'Классическая белая линия на кончиках ногтей. Делается поверх покрытия или наращивания, поэтому её выбирают вместе с одной из этих услуг. Добавляет около 20 минут и держится столько же, сколько покрытие под ней.',
          en: "The classic white line along the tips. It's done over gel polish or extensions, so book it together with one of them. It adds about 20 minutes and lasts as long as the coat underneath.",
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
        details: {
          ro: 'Un design elaborat peste acoperire sau alungire; detaliile le stabilim împreună la începutul programării. Adaugă aproximativ o jumătate de oră. Dacă ai o idee, arată-ne o poză ca exemplu.',
          ru: 'Сложный дизайн поверх покрытия или наращивания; детали обсуждаем вместе в начале визита. Добавляет около получаса. Если у вас есть идея, покажите фото для примера.',
          en: 'An elaborate design over gel polish or extensions; we agree on the details together at the start of your visit. It adds about half an hour. If you have an idea, show us a photo for reference.',
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
        details: {
          ro: 'Modelăm din gel elemente în relief, de exemplu flori sau perle, pe unghiile pe care le alegi. Plătești doar pentru unghiile cu design 3D, iar timpul depinde de câte sunt. Se face peste acoperire sau alungire.',
          ru: 'Создаём из геля объёмные элементы, например цветы или жемчужины, на ногтях, которые вы выберете. Оплата только за ногти с 3D-дизайном, а время зависит от их количества. Делается поверх покрытия или наращивания.',
          en: "We sculpt raised gel details, such as flowers or pearls, on the nails you choose. You pay only for the nails with 3D design, and the time depends on how many there are. It's done over gel polish or extensions.",
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
        details: {
          ro: 'Pentru seturile cu mult design: multe unghii decorate sau mai multe tehnici combinate. Adaugă aproximativ 45 de minute. Arată-ne o poză cu ideea ta, ca s-o discutăm de la început.',
          ru: 'Для сетов с большим количеством дизайна: много украшенных ногтей или несколько техник вместе. Добавляет около 45 минут. Покажите фото с идеей, чтобы обсудить её с самого начала.',
          en: 'For sets with a lot of design: many decorated nails or several techniques together. It adds about 45 minutes. Show us a photo of your idea so we can talk it through at the start.',
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
        details: {
          ro: 'Îndepărtăm cu grijă gelul sau alungirea făcute în alt salon, înainte de noua procedură. Durează aproximativ o jumătate de oră, iar prețul depinde de material. Adaug-o împreună cu serviciul pe care îl vrei după.',
          ru: 'Бережно снимаем гель или наращивание, сделанные в другом салоне, перед новой процедурой. Занимает около получаса, а цена зависит от материала. Выбирайте вместе с услугой, которую хотите сделать после.',
          en: 'We carefully take off gel or extensions done at another salon, before your new treatment. It takes about half an hour, and the price depends on the material. Book it together with the service you want next.',
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
        details: {
          ro: 'Îndepărtăm lacul gel sau alungirea. Durează aproximativ 20 de minute. Potrivită când vrei o pauză de la gel; pentru unghii pilite în formă și cuticule îngrijite, adaugă igiena după scoatere.',
          ru: 'Снимаем гель-лак или наращивание. Занимает около 20 минут. Подходит, если хотите отдохнуть от покрытия; для формы ногтей и ухода за кутикулой добавьте гигиену после снятия.',
          en: 'We take off gel polish or extensions. It takes about 20 minutes. Good for a break from gel; for shaped nails and tidy cuticles, add hygienic care after removal.',
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
        details: {
          ro: 'După scoatere, pilim unghiile naturale în forma aleasă și îngrijim cuticulele. Durează aproximativ o jumătate de oră și se face împreună cu scoaterea. Acasă, un ulei pentru cuticule te ajută să le păstrezi îngrijite mai mult timp.',
          ru: 'После снятия придаём натуральным ногтям выбранную форму и ухаживаем за кутикулой. Занимает около получаса и делается вместе со снятием. Дома масло для кутикулы поможет дольше сохранить ухоженный вид.',
          en: 'After removal, we file your natural nails to your chosen shape and tidy the cuticles. It takes about half an hour and is booked together with a removal. At home, a cuticle oil helps keep them neat for longer.',
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
