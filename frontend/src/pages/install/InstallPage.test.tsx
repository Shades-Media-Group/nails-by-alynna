import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '@/lib/platform';
import common from '@/locales/en/common.json';
import install from '@/locales/en/install.json';
import InstallPage from './InstallPage';

const state = vi.hoisted(() => ({
  platform: { os: 'ios', browser: 'safari', inApp: null, standalone: false, mobile: true } as Platform,
  canPrompt: false,
  loaded: { android: 0, desktop: 0 },
}));

vi.mock('@/lib/platform', () => ({ currentPlatform: () => state.platform }));
vi.mock('@/app/auth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/pwa', () => ({
  useInstallPrompt: () => ({ canPrompt: state.canPrompt, installed: false, prompt: vi.fn() }),
}));
// Counts when each device's drawings are actually loaded.
vi.mock('./AndroidArt', async (importOriginal) => {
  state.loaded.android += 1;
  return importOriginal();
});
vi.mock('./DesktopArt', async (importOriginal) => {
  state.loaded.desktop += 1;
  return importOriginal();
});

function renderPage() {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['install', 'common'],
    defaultNS: 'common',
    resources: { en: { install, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/en/app']}>
          <InstallPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** Locale strings keep lines together with no-break spaces; the DOM queries see plain spaces. */
const nb = (text: string) => text.replace(/\u00a0/g, ' ');
// The section is named by its heading, "How to add it" (with a no-break space before "it").
const region = () => screen.getByRole('region', { name: /^how to add\sit$/i });
const steps = () => within(region()).getAllByRole('listitem');

beforeEach(() => {
  state.platform = { os: 'ios', browser: 'safari', inApp: null, standalone: false, mobile: true };
  state.canPrompt = false;
});

describe('InstallPage', () => {
  it('shows each iPhone step with its screenshot and alt text, and loads no drawings', async () => {
    renderPage();
    const items = steps();
    expect(items).toHaveLength(install.ios.length);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(nb(install.ios[index]!));
      const picture = within(item).getByRole('img', { name: install.iosAlt[index] });
      expect(picture.getAttribute('src')).toMatch(/install-ios-\d/);
      expect(picture).toHaveAttribute('loading', 'lazy');
      expect(picture).toHaveAttribute('width');
      expect(picture).toHaveAttribute('height');
    });
    // English pictures for English text.
    expect(within(items[1]!).getByRole('img').getAttribute('src')).toContain('share-en');
    expect(screen.getByText(nb(install.iosChrome))).toBeInTheDocument();
    expect(state.loaded).toEqual({ android: 0, desktop: 0 });
  });

  it('switching to Android shows its drawn steps with alt text and drops the iPhone pictures', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Android' }));
    const items = steps();
    expect(items).toHaveLength(install.androidManual.length);
    for (const [index, item] of items.entries()) {
      expect(await within(item).findByRole('img', { name: install.androidAlt[index] })).toBeInTheDocument();
    }
    expect(screen.getByText(install.androidLabels.menuItem, { selector: 'span' })).toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="install-ios"]')).toHaveLength(0);
    expect(state.loaded.android).toBeGreaterThan(0);
    expect(state.loaded.desktop).toBe(0);
  });

  it('on a computer shows the QR code and the address-bar drawing', async () => {
    state.platform = { os: 'desktop', browser: 'chrome', inApp: null, standalone: false, mobile: false };
    renderPage();
    expect(screen.getByRole('tab', { name: 'Computer' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('img', { name: install.desktopAlt })).toBeInTheDocument();
    expect(screen.getByText(install.qrTitle, { selector: 'h3' })).toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="install-ios"]')).toHaveLength(0);
  });

  it('keeps the real Install button when Chrome on Android offers one', () => {
    state.platform = { os: 'android', browser: 'chrome', inApp: null, standalone: false, mobile: true };
    state.canPrompt = true;
    renderPage();
    expect(screen.getByRole('button', { name: install.installButton })).toBeInTheDocument();
    expect(within(region()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('still warns inside an in-app browser', () => {
    state.platform = { os: 'ios', browser: 'other', inApp: 'instagram', standalone: false, mobile: true };
    renderPage();
    expect(screen.getByText(/built-in browser/)).toHaveTextContent('Instagram');
    expect(screen.getByRole('button', { name: install.copyLink })).toBeInTheDocument();
  });
});
