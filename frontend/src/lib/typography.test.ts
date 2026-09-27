import { describe, expect, it } from 'vitest';
import { NBSP, noOrphan } from './typography';

/** Shows no-break spaces as "⍽", so a failing test says where they are. */
const shown = (text: string) => text.replaceAll(NBSP, '⍽');

describe('noOrphan', () => {
  it.each([
    ['Alungire, mărimea 1', 'Alungire, mărimea⍽1'],
    ['Corecție, mărimea 6', 'Corecție, mărimea⍽6'],
    ['Наращивание, размер 1', 'Наращивание, размер⍽1'],
    ['Коррекция, размер 3', 'Коррекция, размер⍽3'],
    ['Extensions, size 6', 'Extensions, size⍽6'],
    ['Refill, size 2', 'Refill, size⍽2'],
  ])('keeps the size with its word: %s', (name, expected) => {
    expect(shown(noOrphan(name))).toBe(expected);
  });

  it('keeps a last word of up to three letters with the word before it', () => {
    expect(shown(noOrphan('Acoperire cu lac gel'))).toBe('Acoperire cu lac⍽gel');
    expect(shown(noOrphan('Unde este deschis contul tău'))).toBe('Unde este deschis contul⍽tău');
    expect(shown(noOrphan('Сканировать QR'))).toBe('Сканировать⍽QR');
    expect(shown(noOrphan('Where you’re signed in'))).toBe('Where you’re signed⍽in');
  });

  it('keeps numbers with the short words next to them', () => {
    expect(shown(noOrphan('Lungimea 4 din 6.'))).toBe('Lungimea 4⍽din⍽6.');
    expect(shown(noOrphan('Длина 4 из 6.'))).toBe('Длина 4⍽из⍽6.');
    expect(shown(noOrphan('Length 4 of 6.'))).toBe('Length 4⍽of⍽6.');
    expect(shown(noOrphan('Îndepărtăm materialul aplicat în alt salon: 50 sau 100 MDL, în funcție de material.'))).toBe(
      'Îndepărtăm materialul aplicat în alt salon: 50⍽sau⍽100⍽MDL, în funcție de material.',
    );
    expect(shown(noOrphan('5 MDL за каждый ноготь с 3D-дизайном.'))).toBe('5⍽MDL за каждый ноготь с⍽3D-дизайном.');
    expect(shown(noOrphan('We remove product applied at another salon: 50 or 100 MDL depending on the material.'))).toBe(
      'We remove product applied at another salon: 50⍽or⍽100⍽MDL depending on the material.',
    );
  });

  it('leaves longer last words, single words and empty text alone', () => {
    for (const text of ['Gel polish', 'Сложный дизайн', 'Design complicat', 'French', '', '3D gel design, per nail']) {
      expect(noOrphan(text)).toBe(text);
    }
  });

  it('keeps the line breaks the studio typed', () => {
    expect(shown(noOrphan('Pregătim unghiile.\nApoi lac gel'))).toBe('Pregătim unghiile.\nApoi lac⍽gel');
    expect(shown(noOrphan('Durează 2 ore\ngel'))).toBe('Durează 2⍽ore\ngel');
  });

  it('only turns spaces into no-break spaces, and applying it twice changes nothing more', () => {
    for (const text of ['Alungire, mărimea 1', 'Lungimea 4 din 6.', 'Acoperire cu lac gel', 'Pasul 2 din 4 ']) {
      const once = noOrphan(text);
      expect(once.replaceAll(NBSP, ' ')).toBe(text);
      expect(noOrphan(once)).toBe(once);
    }
  });
});
