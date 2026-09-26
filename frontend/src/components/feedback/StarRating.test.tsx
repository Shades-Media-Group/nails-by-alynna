import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { StarIcon, StarOutlineIcon, type IconComponent } from '@/components/ui/icons';
import feedbackEn from '@/locales/en/feedback.json';
import feedbackRo from '@/locales/ro/feedback.json';
import feedbackRu from '@/locales/ru/feedback.json';
import type { FeedbackRating } from '@/types/api';
import { StarRating, Stars } from './StarRating';

function i18nFor(lng: 'en' | 'ro' | 'ru') {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['feedback'],
    defaultNS: 'feedback',
    resources: {
      en: { feedback: feedbackEn },
      ro: { feedback: feedbackRo },
      ru: { feedback: feedbackRu },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  return instance;
}

function Rating({
  initial = null,
  error,
  onChange,
}: {
  initial?: FeedbackRating | null;
  error?: string;
  onChange?: (value: FeedbackRating) => void;
}) {
  const [value, setValue] = useState<FeedbackRating | null>(initial);
  return (
    <>
      <p id="label">Your rating</p>
      <StarRating
        value={value}
        labelledBy="label"
        error={error}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </>
  );
}

function renderRating(props: Parameters<typeof Rating>[0] = {}, lng: 'en' | 'ro' | 'ru' = 'en') {
  return render(
    <I18nextProvider i18n={i18nFor(lng)}>
      <Rating {...props} />
    </I18nextProvider>,
  );
}

const checked = () =>
  screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true');

/** The drawing of an icon, to tell a filled star from an outline one. */
function shapeOf(Icon: IconComponent): string | null | undefined {
  const { container, unmount } = render(<Icon />);
  const d = container.querySelector('path')?.getAttribute('d');
  unmount();
  return d;
}

describe('star rating', () => {
  it('is a radio group of five stars, named for the screen reader', () => {
    renderRating();
    const group = screen.getByRole('radiogroup', { name: 'Your rating' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      '1 star',
      '2 stars',
      '3 stars',
      '4 stars',
      '5 stars',
    ]);
    expect(checked()).toEqual([]);
    // One tab stop: the first star until something is chosen.
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([
      0, -1, -1, -1, -1,
    ]);
  });

  it('chooses a rating with a tap, filling the stars up to it and naming it', async () => {
    const [filled, outline] = [shapeOf(StarIcon), shapeOf(StarOutlineIcon)];
    expect(filled).not.toBe(outline);
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderRating({ onChange });
    await user.click(screen.getByRole('radio', { name: '4 stars' }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(checked()).toEqual([screen.getByRole('radio', { name: '4 stars' })]);
    expect(screen.getByText('Very good')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([
      -1, -1, -1, 0, -1,
    ]);
    // Filled stars up to the choice, outline after it.
    const shapes = screen
      .getAllByRole('radio')
      .map((radio) => radio.querySelector('path')?.getAttribute('d'));
    expect(shapes).toEqual([filled, filled, filled, filled, outline]);
  });

  it('works from the keyboard: arrows move and choose, stopping at 1 and 5; Home and End jump', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderRating({ onChange });
    await user.tab();
    expect(screen.getByRole('radio', { name: '1 star' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '2 stars' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: '5 stars' })).toHaveFocus();
    expect(checked()).toEqual([screen.getByRole('radio', { name: '5 stars' })]);
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(5);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(4);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(3);
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: '1 star' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(checked()).toEqual([screen.getByRole('radio', { name: '1 star' })]);
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: '5 stars' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(5);

    // Leaving and coming back lands on the chosen star.
    await user.tab({ shift: true });
    await user.tab();
    expect(screen.getByRole('radio', { name: '5 stars' })).toHaveFocus();
  });

  it('says what is missing and ties it to the group', () => {
    renderRating({ error: 'Choose from 1 to 5 stars' });
    const group = screen.getByRole('radiogroup', { name: 'Your rating' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('Choose from 1 to 5 stars');
  });

  it('names the stars in Romanian and Russian, with their plural forms', () => {
    const { unmount } = renderRating({}, 'ro');
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      '1 stea',
      '2 stele',
      '3 stele',
      '4 stele',
      '5 stele',
    ]);
    unmount();
    renderRating({}, 'ru');
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      '1 звезда',
      '2 звезды',
      '3 звезды',
      '4 звезды',
      '5 звёзд',
    ]);
  });

  it('shows a given rating as stars read as a number', () => {
    render(
      <I18nextProvider i18n={i18nFor('en')}>
        <Stars value={3} />
        <Stars value={4.6} decorative />
      </I18nextProvider>,
    );
    expect(screen.getByRole('img', { name: '3 stars' })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
