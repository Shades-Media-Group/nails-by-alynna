import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmStep } from '@/components/booking/ConfirmStep';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import loyalty from '@/locales/en/loyalty.json';
import promoEn from '@/locales/en/promo.json';
import promoRo from '@/locales/ro/promo.json';
import promoRu from '@/locales/ru/promo.json';
import type { Service, Slot } from '@/types/api';
import { usePromoQuote } from './usePromoQuote';

const text = (en: string) => ({ ro: en, ru: en, en });
const service: Service = {
  id: 's1',
  categoryId: 'k1',
  slug: 'gel',
  name: text('Gel polish'),
  description: text(''),
  durationMin: 90,
  price: 450,
  priceFrom: false,
  art: 'gel',
  isPopular: true,
};
const slot: Slot = { start: '2030-03-05T08:00:00.000Z', time: '10:00', staffIds: ['m1'] };

/** Visits already on the client's card: the booking being made is the next one. */
let stampsBefore = 0;
const checks: URLSearchParams[] = [];

function respond(url: URL): Response {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/api/config') {
    return json({
      auth: { google: false, demo: [] },
      studio: { name: 'Nails by Alynna', timezone: 'Europe/Chisinau', currency: 'MDL', tagline: text(''), about: text('') },
      booking: { requireApproval: false, cancellationWindowHours: 12, leadTimeMin: 120, horizonDays: 60, maxActiveBookings: 3, policy: text(''), mastersCount: 1 },
      loyalty: { enabled: true, cycle: 8, rewards: [{ visit: 4, percent: 15 }] },
    });
  }
  if (url.pathname === '/api/catalog') {
    return json({ categories: [{ id: 'k1', slug: 'gel', name: text('Gel'), description: null, singleChoice: false, color: 'blush' }], services: [service] });
  }
  if (url.pathname === '/api/loyalty') {
    return json({
      card: { code: 'K7QM2XRP', url: 'https://example.com/c/K7QM2XRP' },
      loyalty: { enabled: true, cycle: 8, rewards: [{ visit: 4, percent: 15 }], visits: stampsBefore, stamps: stampsBefore, card: 1, nextReward: null, history: [] },
    });
  }
  if (url.pathname === '/api/appointments') return json({ appointments: [] });
  if (url.pathname === '/api/promo/check') {
    checks.push(url.searchParams);
    const code = url.searchParams.get('code');
    if (code === 'SUMMER20') {
      return json({ promo: { code, kind: 'percent', value: 20, discount: 90, total: 450, coveredTotal: 450, serviceIds: null, staffId: null } });
    }
    if (code === 'SMALL10') {
      return json({ promo: { code, kind: 'percent', value: 10, discount: 45, total: 450, coveredTotal: 450, serviceIds: null, staffId: null } });
    }
    const fields = code === 'SUMMER' ? { promoCode: 'expired', endsAt: '2030-02-28' } : { promoCode: 'unknown' };
    return json({ error: { code: 'PROMO_INVALID', message: 'Promo code does not apply', fields } }, 422);
  }
  throw new Error(`Unmocked request: ${url.pathname}`);
}

/** The confirm step as the booking page drives it: the applied code lives above it. */
function Booking({ onSubmit }: { onSubmit: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const promo = usePromoQuote({ code, serviceIds: [service.id], staffId: null, start: slot.start });
  return (
    <ConfirmStep
      mode="new"
      services={[service]}
      slot={slot}
      masterName="Alina"
      needsPhone={false}
      phone=""
      onPhone={() => {}}
      notes=""
      onNotes={() => {}}
      submitting={false}
      error={null}
      onEdit={() => {}}
      onSubmit={onSubmit}
      promo={promo}
      onPromoCode={setCode}
    />
  );
}

function renderStep(onSubmit = vi.fn()) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['booking', 'common', 'loyalty', 'promo'],
    defaultNS: 'common',
    resources: { en: { booking, common, loyalty, promo: promoEn } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/en/book?step=confirm']}>
          <Booking onSubmit={onSubmit} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return onSubmit;
}

beforeEach(() => {
  stampsBefore = 0;
  checks.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => respond(new URL(String(input), 'http://localhost'))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('promo code on the confirm step', () => {
  it('applies a code typed any way, shows the discount and the new total, and Enter never sends the booking', async () => {
    const user = userEvent.setup();
    const onSubmit = renderStep();
    const toggle = await screen.findByRole('button', { name: 'Have a promo code?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    const field = screen.getByRole('textbox', { name: 'Promo code' });
    expect(field).toHaveFocus();
    await user.type(field, 'summer 20{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    expect(await screen.findByText('Promo code SUMMER20')).toBeInTheDocument();
    expect(checks.at(-1)?.get('code')).toBe('SUMMER20');
    expect(checks.at(-1)?.get('staffId')).toBe('any');
    expect(screen.getByText('−20% · −90 MDL')).toBeInTheDocument();
    expect(screen.getByText('To pay').nextElementSibling).toHaveTextContent('360 MDL');
    expect(screen.getByText('Taken off at the studio when you pay.')).toBeInTheDocument();
    // Screen readers hear that it applied (the field itself folds away).
    expect(screen.getByRole('status')).toHaveTextContent('Code SUMMER20 applied');
    // Applied: the field folds away; Remove puts things back.
    expect(screen.queryByRole('textbox', { name: 'Promo code' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the code SUMMER20' }));
    expect(screen.queryByText('Promo code SUMMER20')).not.toBeInTheDocument();
    expect(screen.queryByText('To pay')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Have a promo code?' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('says exactly why a code does not apply, and checks a changed code again', async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole('button', { name: 'Have a promo code?' }));
    const field = screen.getByRole('textbox', { name: 'Promo code' });

    // Not even a possible code: said at once, without asking the server.
    await user.type(field, 'x!');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent("We don't know this code. Check how it's spelled.");
    expect(checks).toHaveLength(0);

    await user.clear(field);
    await user.type(field, 'summer');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('This code is for visits until 28 February.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('To pay')).not.toBeInTheDocument();

    // Editing the code hides the old reason; the right code applies.
    await user.type(field, '20');
    expect(screen.queryByText('This code is for visits until 28 February.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Promo code SUMMER20')).toBeInTheDocument();
  });

  it('keeps the bigger discount when the visit is also a loyalty reward', async () => {
    stampsBefore = 3; // this booking is the 4th visit on the card: 15% off (68 MDL of 450)
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole('button', { name: 'Have a promo code?' }));
    await user.type(screen.getByRole('textbox', { name: 'Promo code' }), 'small10{Enter}');

    const line = (await screen.findByText('Promo code SMALL10')).closest('div')!;
    expect(within(line).getByText(/loyalty discount is bigger/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('To pay').nextElementSibling).toHaveTextContent('382 MDL'));
    // The loyalty note stays: it is the discount the visit gets.
    expect(screen.getByText(/4th visit on the card/)).toBeInTheDocument();
  });
});

describe('promo code copy', () => {
  it('has every string in Romanian, Russian and English, with each language\'s plural forms', () => {
    const flat = (value: unknown, prefix = ''): Record<string, string> =>
      Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((out, [key, v]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof v === 'string' ? { ...out, [path]: v } : { ...out, ...flat(v, path) };
      }, {});
    const base = (key: string) => key.replace(/_(one|few|many|other)$/, '');
    const langs = { en: flat(promoEn), ro: flat(promoRo), ru: flat(promoRu) };
    const keys = new Set(Object.keys(langs.en).map(base));
    const forms = { en: ['one', 'other'], ro: ['one', 'few', 'other'], ru: ['one', 'few', 'many', 'other'] };
    for (const [lang, strings] of Object.entries(langs)) {
      expect(new Set(Object.keys(strings).map(base)), lang).toEqual(keys);
      for (const [key, value] of Object.entries(strings)) expect(value.trim(), `${lang}.${key}`).not.toBe('');
      const plural = new Set(Object.keys(strings).filter((k) => base(k) !== k).map(base));
      for (const key of plural) for (const form of forms[lang as keyof typeof forms]) expect(strings, `${lang}.${key}_${form}`).toHaveProperty(`${key}_${form}`);
    }
    // Romanian ș and ț take a comma below, never a cedilla.
    expect(JSON.stringify(promoRo)).not.toMatch(/[şţŞŢ]/);
  });
});
