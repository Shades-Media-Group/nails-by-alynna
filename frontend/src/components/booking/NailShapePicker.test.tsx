import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import bookingEn from '@/locales/en/booking.json';
import bookingRo from '@/locales/ro/booking.json';
import bookingRu from '@/locales/ru/booking.json';
import { createTestI18n } from '@/test/render';
import type { NailShape } from '@/types/api';
import { NailShapePicker } from './NailShapePicker';

/** The picker as the booking page drives it: the chosen shape lives above it. */
function Picker({
  initial = null,
  invalid = false,
}: {
  initial?: NailShape | null;
  invalid?: boolean;
}) {
  const [shape, setShape] = useState<NailShape | null>(initial);
  return <NailShapePicker value={shape} onChange={setShape} invalid={invalid} />;
}

function renderPicker(props: { initial?: NailShape | null; invalid?: boolean } = {}) {
  return render(
    <I18nextProvider i18n={createTestI18n()}>
      <Picker {...props} />
    </I18nextProvider>,
  );
}

describe('nail shape picker', () => {
  it('offers the four shapes as one radio group, none chosen at first', () => {
    renderPicker();
    const group = screen.getByRole('radiogroup', { name: 'Nail shape' });
    expect(group).toHaveAccessibleDescription(
      'Pick the shape you want; the master files it at the visit.',
    );
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Square',
      'Almond',
      'Round',
      'Stiletto',
    ]);
    // Each name is a FitText: a long one shrinks to fit its tile instead of breaking mid-word.
    for (const radio of radios) {
      expect(radio.querySelector('[data-fit-text]')).toHaveTextContent(radio.textContent ?? '');
    }
    for (const radio of radios) expect(radio).not.toBeChecked();
    // One Tab stop for the group: the first shape while none is chosen.
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('marks the tapped shape as checked, and only that one', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('radio', { name: 'Almond' }));
    expect(screen.getByRole('radio', { name: 'Almond' })).toBeChecked();
    expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(3);

    await user.click(screen.getByRole('radio', { name: 'Stiletto' }));
    expect(screen.getByRole('radio', { name: 'Stiletto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Almond' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Stiletto' })).toHaveAttribute('tabindex', '0');
  });

  it('moves the choice with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup();
    renderPicker({ initial: 'square' });
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Square' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Almond' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Almond' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Stiletto' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Stiletto' })).toHaveFocus();
  });

  it('says politely that a shape is needed', () => {
    renderPicker({ invalid: true });
    const group = screen.getByRole('radiogroup', { name: 'Nail shape' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription(/Please pick a nail shape to continue\.$/);
    expect(screen.getByText('Please pick a nail shape to continue.')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });
});

describe('nail shape copy', () => {
  it('names the shapes as the studio does, with every string in Romanian, Russian and English', () => {
    const names = (shape: typeof bookingEn.shape) => [
      shape.square,
      shape.almond,
      shape.round,
      shape.stiletto,
    ];
    expect(names(bookingRo.shape)).toEqual(['Pătrat', 'Migdală', 'Rotund', 'Stiletto']);
    expect(names(bookingRu.shape)).toEqual(['Квадрат', 'Миндаль', 'Круглая', 'Стилет']);
    expect(names(bookingEn.shape)).toEqual(['Square', 'Almond', 'Round', 'Stiletto']);
    for (const [lang, shape] of Object.entries({
      ro: bookingRo.shape,
      ru: bookingRu.shape,
      en: bookingEn.shape,
    })) {
      expect(Object.keys(shape), lang).toEqual(Object.keys(bookingEn.shape));
      for (const [key, value] of Object.entries(shape))
        expect(value.trim(), `${lang}.shape.${key}`).not.toBe('');
      expect(shape.line, lang).toContain('{{shape}}');
    }
    // Romanian ș and ț take a comma below, never a cedilla.
    expect(JSON.stringify(bookingRo.shape)).not.toMatch(/[şţŞŢ]/);
  });
});
