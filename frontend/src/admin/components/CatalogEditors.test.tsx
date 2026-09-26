import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import type { AdminCategory, AdminService } from '../api';
import { ServiceEditor } from './CatalogEditors';

/*
 * The service editor's "About the procedure": one text per language, saved with the service and
 * sent only when it changed, with the API's messages under the language they are about.
 */

// Keys in the order the API sends them (the database sorts them), not the form's { ro, ru, en }.
const text = (en: string) => ({ en, ro: en, ru: en });
const category: AdminCategory = {
  id: 'k1',
  slug: 'other',
  name: text('Other services'),
  description: null,
  singleChoice: false,
  color: 'peach',
  order: 1,
  isActive: true,
  isDefault: true,
  isLegacy: false,
  customized: [],
};
const service: AdminService = {
  id: 's1',
  categoryId: 'k1',
  slug: 'gel-polish',
  name: text('Gel polish'),
  description: text('Gel polish on natural nails.'),
  details: { en: 'We prep your nails.', ro: 'Pregătim unghiile.', ru: 'Готовим ногти.' },
  durationMin: 90,
  price: 300,
  priceFrom: false,
  art: 'gel',
  isPopular: true,
  order: 1,
  isActive: true,
  isDefault: true,
  isLegacy: false,
  customized: [],
};

let patches: Array<{ path: string; body: Record<string, unknown> }> = [];
/** Reads of the clients' price list, with the browser cache mode they asked for. */
let catalogReads: Array<RequestCache | undefined> = [];
let reply: (body: Record<string, unknown>) => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderEditor(onClose = vi.fn()) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'common'],
    defaultNS: 'common',
    resources: { en: { admin, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/en/admin/services']}>
          <ServiceEditor service={service} categories={[category]} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  patches = [];
  catalogReads = [];
  reply = (body) => json({ service: { ...service, ...body, customized: Object.keys(body) } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push({ path, body });
        return reply(body);
      }
      if (init?.method === 'GET' && path === '/api/catalog') {
        catalogReads.push(init.cache);
        return json({ categories: [category], services: [service] });
      }
      throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const detailsField = (sheet: HTMLElement, language: string) =>
  within(within(sheet).getByRole('group', { name: 'About the procedure' })).getByLabelText(language);

// The whole editor renders (the image picker alone draws 27 illustrations), which is slow in jsdom
// on a busy machine: allow more than the default 5 s.
describe('service editor: about the procedure', { timeout: 20_000 }, () => {
  it('edits the text per language, with the hint and the limit, and sends only it', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();
    const sheet = await screen.findByRole('dialog', { name: 'Edit service' });
    const group = within(sheet).getByRole('group', { name: 'About the procedure' });
    expect(group).toHaveAccessibleDescription(/Clients see this when they tap ⓘ next to the service\./);

    const romanian = detailsField(sheet, 'Română');
    expect(romanian).toHaveValue('Pregătim unghiile.');
    expect(romanian).toHaveAttribute('maxLength', '1500');
    expect(within(group).getByText('18/1500')).toBeInTheDocument();

    // Pasted, not typed key by key: every key re-renders the whole form, image picker included.
    await user.clear(romanian);
    await user.paste('Pregătim unghiile.\n\nȚine 2–3 săptămâni.');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    // Only the text: the name and description are unchanged, whatever order their keys come in,
    // so they keep following the price list.
    expect(patches[0]).toEqual({
      path: '/api/admin/catalog/services/s1',
      body: { details: { ro: 'Pregătim unghiile.\n\nȚine 2–3 săptămâni.', ru: 'Готовим ногти.', en: 'We prep your nails.' } },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The clients' price list on this device is fetched again, past the browser's cached copy.
    await waitFor(() => expect(catalogReads).toEqual(['reload']));
  });

  it('sends nothing when nothing changed', async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();
    const sheet = await screen.findByRole('dialog', { name: 'Edit service' });
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toHaveLength(0);
  });

  it('shows the API’s message under the language it is about', async () => {
    const user = userEvent.setup();
    reply = () => json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { 'details.ru': 'plain_text' } } }, 422);
    renderEditor();
    const sheet = await screen.findByRole('dialog', { name: 'Edit service' });

    await user.click(detailsField(sheet, 'Русский'));
    await user.paste(' <b>!</b>');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    const russian = detailsField(sheet, 'Русский');
    await waitFor(() => expect(russian).toHaveAccessibleDescription('Plain text only, without HTML tags'));
    expect(russian).toHaveAttribute('aria-invalid', 'true');
    expect(detailsField(sheet, 'Română')).not.toHaveAttribute('aria-invalid');
  });
});
