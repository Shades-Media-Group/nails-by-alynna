import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import loyalty from '@/locales/en/loyalty.json';
import type { LoyaltyStatus } from '@/types/api';
import { StampCard } from './StampCard';

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  ns: ['loyalty'],
  defaultNS: 'loyalty',
  resources: { en: { loyalty } },
  interpolation: { escapeValue: false },
  initAsync: false,
});
const wrap = (ui: ReactElement) => <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>;

const status = (stamps: number): LoyaltyStatus => ({
  enabled: true,
  cycle: 6,
  rewards: [{ visit: 4, percent: 15 }],
  visits: stamps,
  stamps,
  card: 1,
  nextReward: null,
  history: [],
});
const popped = () => [...document.querySelectorAll('li')].filter((li) => li.querySelector('.animate-pop')).length;

describe('<StampCard>', () => {
  it('pops a stamp added while the card is open and reads out the new count', () => {
    const { rerender } = render(wrap(<StampCard status={status(2)} />));
    // Opening the card animates nothing and announces nothing.
    expect(popped()).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(wrap(<StampCard status={status(3)} />));
    expect(popped()).toBe(1);
    expect(screen.getAllByRole('listitem')[2]!.querySelector('.animate-pop')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('3 of 6 visits');

    // A stamp taken off: nothing pops, the count is read out again.
    rerender(wrap(<StampCard status={status(2)} />));
    expect(popped()).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 6 visits');
  });
});
