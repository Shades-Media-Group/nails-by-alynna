import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import adminRo from '@/locales/ro/admin.json';
import adminRu from '@/locales/ru/admin.json';
import { RebookSettings } from './RebookSettings';

const text = (en: string, ro = en, ru = en) => ({ ro, ru, en });
const blank = () => ({ title: text(''), body: text('') });

/** GET /api/admin/settings/rebook, as the API answers it. */
const preview = {
  defaults: {
    first: {
      title: text('Time for a refill?', 'E timpul pentru o manichiură nouă?', 'Пора обновить маникюр?'),
      body: text('Hi {name}! Your last visit: {services} with {master}.', 'Bună, {name}! Ultima ta vizită: {services}, cu {master}.'),
    },
    nudge: { title: text('Thinking about your next visit?'), body: text("Hi {name}! It's been a while since your last visit.") },
    last: { title: text("We'd love to see you again"), body: text('Hi {name}! No rush at all.') },
  },
  placeholders: ['name', 'services', 'master'],
  available: { email: true, push: true },
  sample: {
    ro: { name: 'Ana', services: 'Acoperire cu lac gel', master: 'Alina', loyalty: 'Cardul de fidelitate: încă 2 vizite până la −15%.' },
    ru: { name: 'Анна', services: 'Покрытие гель-лаком', master: 'Alina', loyalty: 'Карта лояльности: ещё 2 визита до скидки −15%.' },
    en: { name: 'Ana', services: 'Gel polish', master: 'Alina', loyalty: 'Loyalty card: 2 more visits to 15% off.' },
  },
};

const calls: Array<{ method: string; path: string; body: unknown }> = [];
/** What the server can send (email provider, Web Push keys). */
let available = { email: true, push: true };

function renderSection(settings: Record<string, unknown>, canEdit = true, lng = 'en') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['admin', 'common'],
    defaultNS: 'common',
    resources: { en: { admin, common }, ro: { admin: adminRo, common }, ru: { admin: adminRu, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RebookSettings settings={settings} canEdit={canEdit} email="owner@example.com" />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  available = { email: true, push: true };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
      calls.push({ method, path, body });
      const answer =
        path === '/api/admin/settings/rebook'
          ? { ...preview, available }
          : path === '/api/admin/settings/rebook/test'
            ? { email: { to: 'owner@example.com', sent: true }, push: { sent: 1, devices: 1 } }
            : { settings: { rebook: (body as { rebook?: unknown } | null)?.rebook } };
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const patches = () => calls.filter((c) => c.method === 'PATCH').map((c) => c.body);

describe('Settings → Come-back reminders', () => {
  it('starts from the defaults, shows when each reminder goes and what it says', async () => {
    // A studio that never saved these gets the API defaults.
    renderSection({});
    expect(screen.getByRole('switch', { name: 'Send come-back reminders' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('First reminder after')).toHaveValue('28');
    expect(screen.getByLabelText('Then every')).toHaveValue('14');
    expect(screen.getByLabelText('At most')).toHaveValue('3');
    expect(screen.getByText('Sent 28, 42 and 56 days after the last visit, unless the client books first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'In the app' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // The messages as a phone shows them, filled in with a real service and master.
    const previews = await screen.findAllByRole('figure', { name: 'Notification preview' });
    expect(previews.map((p) => p.textContent)).toEqual([
      'Time for a refill?nowHi Ana! Your last visit: Gel polish with Alina.',
      "Thinking about your next visit?nowHi Ana! It's been a while since your last visit. Loyalty card: 2 more visits to 15% off.",
      "We'd love to see you againnowHi Ana! No rush at all.",
    ]);
    expect(screen.getByText('Day 28')).toBeInTheDocument();
    expect(screen.getByText('Day 42')).toBeInTheDocument();
    expect(screen.getByText('Day 56')).toBeInTheDocument();
  });

  it('saves only what changed, and follows the number of reminders', async () => {
    const user = userEvent.setup();
    renderSection({});
    await user.selectOptions(screen.getByLabelText('First reminder after'), '21');
    await user.selectOptions(screen.getByLabelText('At most'), '5');
    expect(screen.getByText('Sent 21, 35, 49, 63 and 77 days after the last visit, unless the client books first.')).toBeInTheDocument();
    expect(await screen.findByText('Days 35, 49 and 63')).toBeInTheDocument();
    expect(screen.getByText('Day 77')).toBeInTheDocument();
    // The test uses the saved settings: save first.
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeDisabled();
    expect(screen.getByText('Save your changes first: the test uses the saved settings.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toEqual([{ rebook: { firstAfterDays: 21, maxReminders: 5 } }]));
    expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/api/admin/settings');
  });

  it('with a single reminder only the first message goes, and "then every" has no say', async () => {
    const user = userEvent.setup();
    renderSection({ rebook: { enabled: true, firstAfterDays: 30, repeatEveryDays: 14, maxReminders: 3, channels: { email: true, push: true } } });
    await user.selectOptions(screen.getByLabelText('At most'), '1');
    expect(screen.getByLabelText('Then every')).toBeDisabled();
    expect(screen.getByText('Sent 30 days after the last visit, unless the client books first.')).toBeInTheDocument();
    expect(await screen.findAllByText('Not sent with 1 reminder in all')).toHaveLength(2);
  });

  it('needs at least one channel', async () => {
    const user = userEvent.setup();
    renderSection({});
    await user.click(screen.getByRole('button', { name: 'Email' }));
    await user.click(screen.getByRole('button', { name: 'In the app' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one: email or the app.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'In the app' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toEqual([{ rebook: { channels: { email: false, push: true } } }]));
  });

  it('says once when the server cannot send a chosen channel', async () => {
    const user = userEvent.setup();
    available = { email: false, push: true };
    const { unmount } = renderSection({});
    expect(await screen.findByText("Email isn't set up on the server yet: only app notifications go out.")).toBeInTheDocument();
    // Only email chosen: nothing would go out.
    await user.click(screen.getByRole('button', { name: 'In the app' }));
    expect(screen.getByText('Neither email nor app notifications are set up on the server yet, so nothing goes out for now.')).toBeInTheDocument();
    unmount();

    available = { email: false, push: false };
    renderSection({});
    expect(await screen.findByText('Neither email nor app notifications are set up on the server yet, so nothing goes out for now.')).toBeInTheDocument();
    expect(screen.queryByText("Email isn't set up on the server yet: only app notifications go out.")).not.toBeInTheDocument();
  });

  it('edits a message per language, refuses unknown placeholders, and keeps built-in texts empty', async () => {
    const user = userEvent.setup();
    renderSection({});
    await user.click(await screen.findByRole('button', { name: 'Edit: First reminder' }));
    const sheet = await screen.findByRole('dialog', { name: 'First reminder' });
    // Starts from what clients read now.
    const title = within(sheet).getByLabelText('Title');
    expect(title).toHaveValue('Time for a refill?');

    await user.clear(title);
    await user.type(title, 'Ready for new nails, {{nume}?');
    expect(within(sheet).getByText('In braces, use only {name}, {services} or {master}.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('dialog', { name: 'First reminder' })).toBeInTheDocument();

    await user.clear(title);
    await user.type(title, 'Ready for new nails,   {{name}?');
    expect(within(sheet).getByRole('figure', { name: 'Notification preview' })).toHaveTextContent('Ready for new nails, Ana?');
    // The Romanian one too.
    await user.click(within(sheet).getByRole('tab', { name: 'Română' }));
    await user.clear(within(sheet).getByLabelText('Title'));
    await user.type(within(sheet).getByLabelText('Title'), 'Unghii noi, {{name}?');
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'First reminder' })).not.toBeInTheDocument());
    expect(screen.getByText('Your text')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patches()).toEqual([
        { rebook: { texts: { first: { title: { ro: 'Unghii noi, {name}?', ru: '', en: 'Ready for new nails, {name}?' }, body: { ro: '', ru: '', en: '' } } } } },
      ]),
    );
  });

  it('puts a message back to the built-in text', async () => {
    const user = userEvent.setup();
    const custom = { title: { en: 'Missing you!', ro: '', ru: '' }, body: { en: '', ro: '', ru: '' } };
    renderSection({ rebook: { texts: { first: blank(), nudge: custom, last: blank() } } });
    expect(await screen.findByText('Missing you!')).toBeInTheDocument();
    expect(screen.getByText('Your text')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use the built-in text' }));
    expect(screen.queryByText('Missing you!')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches()).toEqual([{ rebook: { texts: { nudge: blank() } } }]));
  });

  it('is not changed by the order the API returns text keys in', async () => {
    // The database sorts keys ({ en, ro, ru }); the form builds { ro, ru, en }.
    const sorted = { title: { en: '', ro: '', ru: '' }, body: { en: '', ro: '', ru: '' } };
    renderSection({
      rebook: { enabled: true, firstAfterDays: 28, maxReminders: 3, repeatEveryDays: 14, channels: { push: true, email: true }, texts: { first: sorted, last: sorted, nudge: sorted } },
    });
    await screen.findAllByRole('figure', { name: 'Notification preview' });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send me a test' })).toBeEnabled();
  });

  it('sends the owner a test', async () => {
    const user = userEvent.setup();
    renderSection({});
    expect(screen.getByText('The first reminder, to owner@example.com and to your phones with notifications on.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send me a test' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/settings/rebook/test')).toBe(true));
  });

  it('shows the rules and messages read-only to the team', async () => {
    renderSection({ rebook: { enabled: true, firstAfterDays: 21, repeatEveryDays: 7, maxReminders: 2, channels: { email: true, push: false } } }, false);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('21 days')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('2 reminders')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(await screen.findAllByRole('figure', { name: 'Notification preview' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send me a test' })).not.toBeInTheDocument();
  });

  it('reads in Romanian and Russian', async () => {
    const { unmount } = renderSection({}, true, 'ro');
    expect(screen.getByText('Se trimit la 28, 42 și 56 de zile după ultima vizită, dacă clientul nu se programează între timp.')).toBeInTheDocument();
    expect(await screen.findByText('Bună, Ana! Ultima ta vizită: Acoperire cu lac gel, cu Alina.')).toBeInTheDocument();
    unmount();
    renderSection({}, true, 'ru');
    expect(screen.getByText('Отправляются через 28, 42 и 56 дней после последнего визита, если клиент не запишется раньше.')).toBeInTheDocument();
    expect(screen.getByLabelText('Первое напоминание через')).toHaveDisplayValue('28 дней');
  });

  it('has every string in Romanian, Russian and English', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, v]) => flatten(v, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const base = (key: string) => key.replace(/_(one|few|many|other)$/, '');
    const keys = (block: unknown) => [...new Set(flatten(block).map(base))].sort();
    const blocks = { en: admin.rebook, ro: adminRo.rebook, ru: adminRu.rebook };
    for (const [lang, block] of Object.entries(blocks)) {
      expect(keys(block), lang).toEqual(keys(admin.rebook));
      for (const key of flatten(block)) {
        const value = key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], block);
        expect(String(value).trim(), `${lang}.${key}`).not.toBe('');
      }
    }
    // Romanian and Russian plural forms of the counters.
    expect(Object.keys(adminRo.rebook)).toEqual(expect.arrayContaining(['days_few', 'reminders_few', 'timeline_few']));
    expect(Object.keys(adminRu.rebook)).toEqual(expect.arrayContaining(['days_many', 'reminders_many', 'timeline_many']));
    // Romanian ș and ț take a comma below, never a cedilla.
    expect(JSON.stringify(adminRo.rebook)).not.toMatch(/[şţŞŢ]/);
  });
});
