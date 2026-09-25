import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import auth from '@/locales/en/auth.json';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';

/** English i18n instance with bundled resources (no lazy loading in tests). */
export function createTestI18n() {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common', 'auth', 'booking'],
    defaultNS: 'common',
    resources: { en: { common, auth, booking } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  return instance;
}

export function renderWithProviders(ui: ReactElement, { route = '/en/login' }: { route?: string } = {}) {
  const i18n = createTestI18n();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}
