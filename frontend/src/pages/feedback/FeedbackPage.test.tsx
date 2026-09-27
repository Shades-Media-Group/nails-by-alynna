import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import feedbackEn from '@/locales/en/feedback.json';
import feedbackRo from '@/locales/ro/feedback.json';
import feedbackRu from '@/locales/ru/feedback.json';
import FeedbackPage from './FeedbackPage';

const VISIT = '66f5a1b2c3d4e5f6a7b8c9d0';
const text = (en: string) => ({ ro: en, ru: en, en });
const HOUR = 3_600_000;

let visitStatus = 'completed';
let visitEnd = new Date(Date.now() - 2 * HOUR);
let sendFails: { status: number; code: string } | null = null;
const posts: Array<{ path: string; body: unknown }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function respond(url: URL, init?: RequestInit): Response {
  if (init?.method === 'POST' && url.pathname === '/api/feedback') {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posts.push({ path: url.pathname, body });
    if (sendFails)
      return json({ error: { code: sendFails.code, message: 'No' } }, sendFails.status);
    const now = new Date().toISOString();
    return json(
      {
        feedback: {
          id: 'f1',
          kind: body.appointmentId ? 'visit' : 'general',
          appointmentId: body.appointmentId ?? null,
          rating: body.rating ?? null,
          comment: body.comment ?? '',
          createdAt: now,
          updatedAt: now,
        },
      },
      201,
    );
  }
  if (url.pathname === '/api/config') {
    return json({
      auth: { google: false, demo: [] },
      studio: {
        name: 'Nails by Alynna',
        timezone: 'Europe/Chisinau',
        currency: 'MDL',
        tagline: text(''),
        about: text(''),
      },
      booking: {
        requireApproval: false,
        cancellationWindowHours: 12,
        leadTimeMin: 120,
        horizonDays: 60,
        maxActiveBookings: 3,
        policy: text(''),
        mastersCount: 1,
      },
      loyalty: { enabled: true, cycle: 8, rewards: [] },
    });
  }
  if (url.pathname === `/api/appointments/${VISIT}`) {
    return json({
      appointment: {
        id: VISIT,
        code: 'A7K2Q9',
        status: visitStatus,
        start: new Date(visitEnd.getTime() - 90 * 60_000).toISOString(),
        end: visitEnd.toISOString(),
        durationMin: 90,
        totalPrice: 450,
        priceFrom: false,
        services: [
          { id: 's1', name: text('Gel polish'), durationMin: 90, price: 450, priceFrom: false },
        ],
        staff: { id: 'm1', name: 'Alina', title: text('Nail master'), color: 'blush' },
        notes: '',
        canChange: false,
        changeDeadline: visitEnd.toISOString(),
        cancelledAt: null,
        cancelledBy: null,
        loyalty: null,
        createdAt: visitEnd.toISOString(),
      },
    });
  }
  throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${url.pathname}`);
}

function renderPage(url: string, lng: 'en' | 'ro' | 'ru' = 'en') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['common', 'booking', 'feedback'],
    defaultNS: 'common',
    resources: {
      en: { common, booking, feedback: feedbackEn },
      ro: { feedback: feedbackRo },
      ru: { feedback: feedbackRu },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/:lang/feedback" element={<FeedbackPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  visitStatus = 'completed';
  visitEnd = new Date(Date.now() - 2 * HOUR);
  sendFails = null;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), 'http://localhost'), init),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('feedback on a visit', () => {
  it('opens with the stars from the email link chosen, sends them with the comment, then thanks', async () => {
    const user = userEvent.setup();
    renderPage(`/en/feedback?visit=${VISIT}&rating=4`);

    expect(
      await screen.findByText('Only Alina and the studio read it. It is never published.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How was your visit?' })).toBeInTheDocument();
    expect(screen.getByText('Gel polish')).toBeInTheDocument();
    expect(screen.getByText('with Alina')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Very good')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '5 stars' }));
    await user.type(
      screen.getByRole('textbox', { name: 'What went well, and what could be better?' }),
      '  Perfect French, thank you!  ',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toHaveFocus();
    expect(posts).toEqual([
      {
        path: '/api/feedback',
        body: { appointmentId: VISIT, rating: 5, comment: 'Perfect French, thank you!' },
      },
    ]);
    expect(screen.getByText('Your feedback went to Alina and the studio.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/en/home');
  });

  it('asks for the stars before sending (a comment is optional)', async () => {
    const user = userEvent.setup();
    renderPage(`/en/feedback?visit=${VISIT}`);
    await user.click(await screen.findByRole('button', { name: 'Send' }));

    expect(posts).toEqual([]);
    const group = screen.getByRole('radiogroup', { name: 'Your rating' });
    expect(group).toHaveAccessibleDescription(/^Choose from\s1\sto\s5\sstars$/);
    expect(screen.getByRole('radio', { name: '1 star' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.queryByText('Choose from 1 to 5 stars')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(posts).toEqual([
        { path: '/api/feedback', body: { appointmentId: VISIT, rating: 5, comment: '' } },
      ]),
    );
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
  });

  it('says why a visit cannot be rated, and offers a message to the studio instead', async () => {
    visitStatus = 'confirmed';
    const { unmount } = renderPage(`/en/feedback?visit=${VISIT}&rating=5`);
    expect(
      await screen.findByText('A visit can be rated once it has taken place.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write to the studio' })).toHaveAttribute(
      'href',
      '/en/feedback',
    );
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    unmount();

    visitStatus = 'completed';
    visitEnd = new Date(Date.now() - 15 * 24 * HOUR);
    const old = renderPage(`/en/feedback?visit=${VISIT}`);
    expect(
      await screen.findByText('Visits can be rated for two weeks after them.'),
    ).toBeInTheDocument();
    old.unmount();

    renderPage('/en/feedback?visit=not-an-id');
    expect(
      await screen.findByText("We couldn't find this visit. It may belong to another account."),
    ).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('shows what the studio answered when sending fails', async () => {
    sendFails = { status: 409, code: 'FEEDBACK_CLOSED' };
    const user = userEvent.setup();
    renderPage(`/en/feedback?visit=${VISIT}&rating=3`);
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Visits can be rated for two weeks after them. You can still write to the studio.',
    );
    expect(screen.queryByRole('heading', { name: 'Thank you!' })).not.toBeInTheDocument();
  });
});

describe('a message to the studio', () => {
  it('needs a few words, takes optional stars, and thanks', async () => {
    const user = userEvent.setup();
    renderPage('/en/feedback');
    expect(await screen.findByRole('heading', { name: 'Send feedback' })).toBeInTheDocument();
    const message = screen.getByRole('textbox', { name: 'Your message' });

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(message).toHaveAccessibleDescription('Write a few words');
    expect(message).toHaveFocus();
    await user.type(message, 'ok');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(posts).toEqual([]);

    await user.clear(message);
    await user.type(message, 'Please add evening hours on Fridays');
    await user.click(screen.getByRole('radio', { name: '4 stars' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
    expect(posts).toEqual([
      {
        path: '/api/feedback',
        body: { rating: 4, comment: 'Please add evening hours on Fridays' },
      },
    ]);
    expect(screen.getByText('Your message went straight to the studio.')).toBeInTheDocument();
  });
});

describe('feedback copy', () => {
  it("has every string in Romanian, Russian and English, with each language's plural forms", () => {
    const flat = (value: unknown, prefix = ''): Record<string, string> =>
      Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
        (out, [key, v]) => {
          const path = prefix ? `${prefix}.${key}` : key;
          return typeof v === 'string' ? { ...out, [path]: v } : { ...out, ...flat(v, path) };
        },
        {},
      );
    const base = (key: string) => key.replace(/_(one|few|many|other)$/, '');
    const langs = { en: flat(feedbackEn), ro: flat(feedbackRo), ru: flat(feedbackRu) };
    const keys = new Set(Object.keys(langs.en).map(base));
    const forms = {
      en: ['one', 'other'],
      ro: ['one', 'few', 'other'],
      ru: ['one', 'few', 'many', 'other'],
    };
    for (const [lang, strings] of Object.entries(langs)) {
      expect(new Set(Object.keys(strings).map(base)), lang).toEqual(keys);
      for (const [key, value] of Object.entries(strings))
        expect(value.trim(), `${lang}.${key}`).not.toBe('');
      const plural = new Set(
        Object.keys(strings)
          .filter((k) => base(k) !== k)
          .map(base),
      );
      for (const key of plural)
        for (const form of forms[lang as keyof typeof forms])
          expect(strings, `${lang}.${key}_${form}`).toHaveProperty(`${key}_${form}`);
    }
    // Romanian ș and ț take a comma below, never a cedilla; no star glyphs stand in for icons.
    expect(JSON.stringify(feedbackRo)).not.toMatch(/[şţŞŢ]/);
    expect(JSON.stringify([feedbackEn, feedbackRo, feedbackRu])).not.toMatch(/[★☆⭐]/u);
  });
});
