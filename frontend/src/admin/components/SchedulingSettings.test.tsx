import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import adminRo from '@/locales/ro/admin.json';
import adminRu from '@/locales/ru/admin.json';
import { SchedulingSettings } from './SchedulingSettings';

function renderSection(settings: Record<string, unknown>, canEdit: boolean) {
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
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SchedulingSettings settings={settings} canEdit={canEdit} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const patches: unknown[] = [];

beforeEach(() => {
  patches.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      patches.push(body);
      const settings = { smartSlots: true, maxGapMin: 10, minBookableGapMin: 90, ...body };
      return new Response(JSON.stringify({ settings }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Settings → Smart scheduling', () => {
  it('explains the rule in plain words and saves only what changed', async () => {
    const user = userEvent.setup();
    // A studio that never saved these gets the API defaults.
    renderSection({}, true);

    expect(screen.getByRole('switch', { name: 'Offer compact times' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/with no gap longer than 10 min that nobody can book/)).toBeInTheDocument();
    expect(screen.getByLabelText('Allowed gap between visits')).toHaveValue('10');
    expect(screen.getByLabelText('Shortest gap worth keeping open')).toHaveValue('90');
    expect(screen.getByRole('option', { name: '1 h 30 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // A worked example in the owner's terms, following the chosen values.
    expect(screen.getByText(/next visit can start at 11:30–11:40, or at 13:00 or later/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Allowed gap between visits'), '5');
    expect(screen.getByText(/with no gap longer than 5 min that nobody can book/)).toBeInTheDocument();
    expect(screen.getByText(/next visit can start at 11:30–11:35, or at 13:00 or later/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toEqual([{ maxGapMin: 5 }]));
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/admin/settings');
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
  });

  it('turning it off greys out the gap choices and says clients see every free time', async () => {
    const user = userEvent.setup();
    renderSection({ smartSlots: true, maxGapMin: 0, minBookableGapMin: 120 }, true);
    expect(screen.getByText(/visits strictly back to back/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Offer compact times' }));
    expect(screen.getByText('Clients see every free time, even ones that leave gaps nobody can book.')).toBeInTheDocument();
    expect(screen.getByLabelText('Allowed gap between visits')).toBeDisabled();
    expect(screen.getByLabelText('Shortest gap worth keeping open')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toEqual([{ smartSlots: false }]));
  });

  it('shows the rules read-only to the team', () => {
    const { unmount } = renderSection({ smartSlots: true, maxGapMin: 10, minBookableGapMin: 90 }, false);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
    unmount();

    renderSection({ smartSlots: false, maxGapMin: 10, minBookableGapMin: 90 }, false);
    expect(screen.getByText('Off: clients see every free time')).toBeInTheDocument();
    expect(screen.queryByText('Allowed gap between visits')).not.toBeInTheDocument();
  });

  it('has every string in Romanian, Russian and English', () => {
    const blocks = { en: admin.scheduling, ro: adminRo.scheduling, ru: adminRu.scheduling } as Record<string, Record<string, string>>;
    const keys = Object.keys(blocks.en!).sort();
    for (const [lang, block] of Object.entries(blocks)) {
      expect(Object.keys(block).sort(), lang).toEqual(keys);
      for (const [key, value] of Object.entries(block)) expect(value.trim(), `${lang}.${key}`).not.toBe('');
      expect(block.smartSlotsText, lang).toContain('{{gap}}');
    }
    // Romanian ș and ț take a comma below, never a cedilla.
    expect(JSON.stringify(adminRo.scheduling)).not.toMatch(/[şţŞŢ]/);
  });
});
