import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetConsentForTests, openConsentSettings, readConsent } from '@/lib/consent';
import { renderWithProviders } from '@/test/render';
import { ConsentBanner } from './ConsentBanner';
import { act } from 'react';

beforeEach(() => {
  localStorage.clear();
  __resetConsentForTests();
});

describe('<ConsentBanner>', () => {
  it('offers Minimal, Custom and Accept all until a choice is made', async () => {
    renderWithProviders(<ConsentBanner />);
    expect(screen.getByRole('dialog', { name: /quick word on privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
    expect(readConsent()).toMatchObject({ analytics: true, preferences: true });
  });

  it('Minimal stores only essentials', async () => {
    renderWithProviders(<ConsentBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Minimal' }));
    expect(readConsent()).toMatchObject({ analytics: false, preferences: false });
  });

  it('Custom shows tick boxes; optional ones start unticked and essential is locked', async () => {
    renderWithProviders(<ConsentBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));

    const essential = screen.getByRole('checkbox', { name: /essential/i });
    const preferences = screen.getByRole('checkbox', { name: /preferences/i });
    const analytics = screen.getByRole('checkbox', { name: /anonymous statistics/i });
    expect(essential).toBeChecked();
    expect(essential).toBeDisabled();
    expect(preferences).not.toBeChecked();
    expect(analytics).not.toBeChecked();

    await userEvent.click(preferences);
    await userEvent.click(screen.getByRole('button', { name: 'Save my choice' }));
    expect(readConsent()).toMatchObject({ preferences: true, analytics: false });
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });

  it('can be reopened from settings with the saved choice ticked', async () => {
    renderWithProviders(<ConsentBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    act(() => openConsentSettings());
    expect(screen.getByRole('checkbox', { name: /anonymous statistics/i })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });
});
