import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as PlatformModule from '@/lib/platform';
import { renderWithProviders } from '@/test/render';
import type { User } from '@/types/api';
import ProfilePage from './ProfilePage';

const platform = vi.hoisted(() => ({ standalone: false }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  currentPlatform: () => ({
    os: 'ios',
    browser: 'safari',
    inApp: false,
    standalone: platform.standalone,
    mobile: true,
  }),
}));

const user: User = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  surname: 'Rusu',
  phone: null,
  role: 'client',
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
};
vi.mock('@/app/auth', () => ({
  useAuth: () => ({
    user,
    status: 'authenticated',
    isStaff: false,
    signedOut: false,
    setUser: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  }),
}));

afterEach(() => {
  platform.standalone = false;
});

const installLink = () =>
  screen.queryAllByRole('link').find((link) => link.getAttribute('href')?.endsWith('/app'));

describe('<ProfilePage> install row', () => {
  it('offers to install the app in a browser', () => {
    renderWithProviders(<ProfilePage />, { route: '/en/profile' });
    expect(installLink()).toBeDefined();
  });

  it('is gone inside the installed app', () => {
    platform.standalone = true;
    renderWithProviders(<ProfilePage />, { route: '/en/profile' });
    expect(installLink()).toBeUndefined();
    // The rest of the group stays.
    expect(
      screen.queryAllByRole('link').some((link) => link.getAttribute('href')?.endsWith('/terms')),
    ).toBe(true);
  });
});
