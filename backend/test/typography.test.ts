import { describe, expect, it } from 'vitest';
import { bookingUpdateEmail, loyaltyNextEmail, welcomeEmail, type VisitInfo } from '../src/lib/emails';
import { NBSP, noOrphan } from '../src/lib/text';

/** Shows no-break spaces as "⍽", so a failing test says where they are. */
const shown = (text: string) => text.replaceAll(NBSP, '⍽');

describe('noOrphan', () => {
  it('keeps a short last word or number with the word before it, in every language', () => {
    expect(shown(noOrphan('Alungire, mărimea 1'))).toBe('Alungire, mărimea⍽1');
    expect(shown(noOrphan('Наращивание, размер 3'))).toBe('Наращивание, размер⍽3');
    expect(shown(noOrphan('Extensions, size 6'))).toBe('Extensions, size⍽6');
    expect(shown(noOrphan('Acoperire cu lac gel'))).toBe('Acoperire cu lac⍽gel');
    expect(shown(noOrphan('Următoarea ta vizită are −15%'))).toBe('Următoarea ta vizită are⍽−15%');
    expect(shown(noOrphan('Ваш следующий визит −15%'))).toBe('Ваш следующий визит⍽−15%');
  });

  it('keeps numbers with the short words next to them and leaves the rest alone', () => {
    expect(shown(noOrphan('Lungimea 4 din 6.'))).toBe('Lungimea 4⍽din⍽6.');
    expect(shown(noOrphan('50 или 100 MDL в зависимости от материала.'))).toBe('50⍽или⍽100⍽MDL в зависимости от материала.');
    expect(noOrphan('Gel polish')).toBe('Gel polish');
    expect(noOrphan('Hygienic care after removal')).toBe('Hygienic care after removal');
    expect(shown(noOrphan('Pregătim unghiile.\nApoi lac gel'))).toBe('Pregătim unghiile.\nApoi lac⍽gel');
  });
});

const visit: VisitInfo = {
  code: 'K7QM2X',
  start: new Date('2026-10-16T11:00:00Z'), // Friday 14:00 in Chișinău
  status: 'confirmed',
  services: ['Alungire, mărimea 1', 'Acoperire cu lac gel'],
  master: 'Alina',
  address: 'str. Ismail 88',
  bookingUrl: 'https://app.test/bookings/1',
  directionsUrl: null,
  bookUrl: 'https://app.test/book',
  settingsUrl: 'https://app.test/profile/notifications',
  changeDeadline: new Date('2026-10-15T11:00:00Z'),
  studioPhone: null,
  lines: [
    { name: 'Alungire, mărimea 1', price: 400, priceFrom: false },
    { name: 'Design 3D din gel, per unghie', price: 5, priceFrom: true },
  ],
  total: { amount: 1200, from: true, currency: 'MDL' },
  durationMin: 150,
};

describe('emails never split a value or leave a word alone', () => {
  it('binds lengths, amounts, dates and names in a visit email', () => {
    const ro = shown(bookingUpdateEmail({ to: 'ana@gmail.com', name: 'Ana', locale: 'ro', timeZone: 'Europe/Chisinau', now: new Date('2026-10-01T09:00:00Z'), kind: 'confirmed', visit }).html);
    expect(ro).toContain('2⍽h⍽30⍽min');
    expect(ro).toContain('400⍽MDL');
    expect(ro).toContain('de⍽la⍽5⍽MDL');
    expect(ro).toContain('de⍽la⍽1.200⍽MDL');
    expect(ro).toContain('Alungire, mărimea⍽1');
    expect(ro).toContain('Vineri, 16⍽octombrie');
    // The deadline: "până pe 15 octombrie la 14:00".
    expect(ro).toContain('15⍽octombrie la⍽14:00');
    expect(ro).toContain('str. Ismail⍽88');

    const ru = shown(bookingUpdateEmail({ to: 'ana@gmail.com', name: 'Аня', locale: 'ru', timeZone: 'Europe/Chisinau', now: new Date('2026-10-01T09:00:00Z'), kind: 'confirmed', visit }).html);
    expect(ru).toContain('2⍽ч⍽30⍽мин');
    expect(ru).toContain('от⍽1⍽200⍽MDL');
    expect(ru).toContain('Пятница, 16⍽октября');
  });

  it('keeps the discount with its words in the headline and the loyalty lines', () => {
    const next = loyaltyNextEmail({ to: 'ana@gmail.com', name: 'Ana', locale: 'ro', appUrl: 'https://app.test', percent: 15 });
    expect(shown(next.html)).toContain('Următoarea ta vizită are⍽−15%</h1>');
    expect(next.html).toContain('text-wrap:balance');

    const welcome = shown(
      welcomeEmail({ to: 'ana@gmail.com', name: 'Ana', locale: 'ro', appUrl: 'https://app.test', rewards: [{ visit: 4, percent: 15 }, { visit: 8, percent: 30 }] }).html,
    );
    expect(welcome).toContain('a⍽4-a vizită are⍽−15%');
    const en = shown(
      welcomeEmail({ to: 'ana@gmail.com', name: 'Ana', locale: 'en', appUrl: 'https://app.test', rewards: [{ visit: 4, percent: 15 }] }).html,
    );
    expect(en).toContain('your 4th visit is⍽15%⍽off');
  });
});
