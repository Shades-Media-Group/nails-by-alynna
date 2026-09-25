import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { OtpInput } from './OtpInput';

function Harness({ onComplete, initial = '', onSubmit }: { onComplete?: (code: string) => void; initial?: string; onSubmit?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <OtpInput label="6-digit code" value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </form>
  );
}

const field = () => screen.getByRole('textbox', { name: '6-digit code' });
const value = () => screen.getByTestId('value').textContent;
const shownDigits = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-otp-box]')].map((box) => box.textContent ?? '');

describe('<OtpInput>', () => {
  it('is one labelled numeric field that offers the emailed code, drawn as six boxes', () => {
    const { container } = renderWithProviders(<Harness />);
    expect(field()).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field()).toHaveAttribute('inputmode', 'numeric');
    expect(field()).toHaveAttribute('maxlength', '6');
    expect(container.querySelectorAll('[data-otp-box]')).toHaveLength(6);
    expect(container.querySelector('[data-otp-box]')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('fills the boxes while typing, ignores letters and completes on the last digit', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Harness onComplete={onComplete} />);
    await user.click(field());
    await user.keyboard('12a3');
    expect(value()).toBe('123');
    expect(shownDigits(container)).toEqual(['1', '2', '3', '', '', '']);
    await user.keyboard('456');
    expect(value()).toBe('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('clears from the end with Backspace', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial="123" />);
    await user.click(field());
    await user.keyboard('{Backspace}');
    expect(value()).toBe('12');
    await user.keyboard('{Backspace}{Backspace}');
    expect(value()).toBe('');
  });

  it('takes a pasted code out of surrounding text', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Harness onComplete={onComplete} />);
    await user.click(field());
    await user.paste('Your code: 987 654');
    expect(value()).toBe('987654');
    expect(shownDigits(container)).toEqual(['9', '8', '7', '6', '5', '4']);
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('takes an autofilled code (iOS / Android suggest it from Mail)', () => {
    const onComplete = vi.fn();
    renderWithProviders(<Harness onComplete={onComplete} />);
    fireEvent.change(field(), { target: { value: '246810' } });
    expect(value()).toBe('246810');
    expect(onComplete).toHaveBeenCalledWith('246810');
  });

  it('never submits half a code with Enter; a whole one goes to onComplete', async () => {
    const onComplete = vi.fn();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness onComplete={onComplete} onSubmit={onSubmit} initial="12" />);
    await user.click(field());
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard('3456');
    onComplete.mockClear();
    await user.keyboard('{Enter}');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
