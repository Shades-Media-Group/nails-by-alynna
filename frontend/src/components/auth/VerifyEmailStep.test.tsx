import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/client';
import { renderWithProviders } from '@/test/render';
import { VerifyEmailStep } from './VerifyEmailStep';

const api = vi.hoisted(() => ({ resendVerification: vi.fn(), verifyEmail: vi.fn() }));
vi.mock('@/services/api/endpoints', () => ({ authApi: api }));

const step = (props: Partial<Parameters<typeof VerifyEmailStep>[0]> = {}) => (
  <VerifyEmailStep
    email="ana@gmail.com"
    remember
    reason="signup"
    resendAfterSec={0}
    onVerified={() => {}}
    onChangeEmail={() => {}}
    {...props}
  />
);

beforeEach(() => {
  api.resendVerification.mockReset();
});

describe('<VerifyEmailStep>', () => {
  it('asks to check the inbox when the code went out', () => {
    renderWithProviders(step());
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/Check Spam or Promotions/)).toBeInTheDocument();
  });

  it('says the email did not go out, and switches to "check your email" once a resend works', async () => {
    const onResent = vi.fn();
    api.resendVerification.mockResolvedValue({ ok: true, resendAfterSec: 60 });
    renderWithProviders(step({ sent: false, onResent }));

    expect(screen.getByRole('heading', { name: "The email didn't go out" })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ana@gmail.com');
    expect(screen.queryByText(/Check Spam or Promotions/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(api.resendVerification).toHaveBeenCalledWith('ana@gmail.com', expect.any(String));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(onResent).toHaveBeenCalledOnce();
  });

  it('keeps saying so when the resend fails too', async () => {
    api.resendVerification.mockRejectedValue(new ApiError(503, 'EMAIL_NOT_SENT', 'not sent'));
    renderWithProviders(step({ sent: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByText("We couldn't send the email right now. Try again in a few minutes.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "The email didn't go out" })).toBeInTheDocument();
  });
});
