import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import type { Service } from '@/types/api';
import { ServiceCard } from './ServiceCard';

/*
 * The ⓘ under a service's +: it opens "about the procedure" (the studio's text, with the tile,
 * time and price) and never adds the service itself; the sheet's button does, like the +.
 */

const text = (en: string) => ({ ro: en, ru: en, en });
const gel: Service = {
  id: 's1',
  categoryId: 'k1',
  slug: 'gel-polish',
  name: text('Gel polish'),
  description: text('Gel polish on natural nails.'),
  details: text('We prep your nails and apply gel polish.\n\nIt usually lasts 2–3 weeks;\nwear gloves when cleaning.'),
  durationMin: 90,
  price: 300,
  priceFrom: false,
  art: 'gel',
  isPopular: true,
};

/** The row as the services list drives it: what is chosen lives above it. */
function Row({ service, onToggle }: { service: Service; onToggle: (service: Service) => void }) {
  const [selected, setSelected] = useState(false);
  return (
    <ServiceCard
      service={service}
      color="peach"
      currency="MDL"
      selected={selected}
      onToggle={(picked) => {
        onToggle(picked);
        setSelected((value) => !value);
      }}
    />
  );
}

function renderRow(service: Service = gel) {
  const onToggle = vi.fn();
  renderWithProviders(<Row service={service} onToggle={onToggle} />, { route: '/en/services' });
  return { onToggle, row: screen.getByRole('button', { name: /^(Add|Remove) Gel polish$/ }) };
}

beforeEach(() => {
  // Reduced motion: the sheet closes without waiting for its slide-down.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('about the procedure', () => {
  it('opens from the ⓘ with the text, time and price, and adds nothing', async () => {
    const user = userEvent.setup();
    const { onToggle, row } = renderRow();

    const info = screen.getByRole('button', { name: 'About Gel polish' });
    expect(info).toHaveAttribute('aria-haspopup', 'dialog');
    // A sibling of the row's button, never inside it.
    expect(row).not.toContainElement(info);

    await user.click(info);
    const sheet = await screen.findByRole('dialog', { name: 'Gel polish' });
    expect(onToggle).not.toHaveBeenCalled();
    expect(row).toHaveAttribute('aria-pressed', 'false');

    // Focus moved into the sheet.
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    expect(within(sheet).getByText('1 h 30 min')).toBeInTheDocument();
    expect(within(sheet).getByText('300 MDL')).toBeInTheDocument();
    // A blank line makes two paragraphs; a single line break stays inside one.
    const paragraphs = within(sheet)
      .getAllByText(/./, { selector: 'p' })
      .filter((p) => !p.classList.contains('sr-only'));
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'We prep your nails and apply gel polish.',
      'It usually lasts 2–3 weeks;\nwear gloves when cleaning.',
    ]);
    expect(sheet.innerHTML).not.toContain('<br');
  });

  it('adds the service from the sheet, then offers to remove it', async () => {
    const user = userEvent.setup();
    const { onToggle, row } = renderRow();
    await user.click(screen.getByRole('button', { name: 'About Gel polish' }));
    const sheet = await screen.findByRole('dialog', { name: 'Gel polish' });

    await user.click(within(sheet).getByRole('button', { name: 'Add to booking' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(gel);
    // The sheet stays open and mirrors the row's +.
    expect(within(sheet).getByRole('button', { name: 'Remove from booking' })).toBeInTheDocument();
    expect(within(sheet).getByText('Added to your booking: Gel polish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Gel polish' })).toHaveAttribute('aria-pressed', 'true');
    expect(row).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(sheet).getByRole('button', { name: 'Remove from booking' }));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(within(sheet).getByRole('button', { name: 'Add to booking' })).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes on Escape and gives focus back to the ⓘ', async () => {
    const user = userEvent.setup();
    renderRow();
    const info = screen.getByRole('button', { name: 'About Gel polish' });
    await user.click(info);
    const sheet = await screen.findByRole('dialog', { name: 'Gel polish' });

    // What the browser does on Escape: a cancel event on the modal dialog.
    fireEvent(sheet, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(info).toHaveFocus();

    // The close button does the same.
    await user.click(info);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(info).toHaveFocus();
  });

  it('shows no ⓘ when the studio wrote nothing', () => {
    renderRow({ ...gel, details: text('  ') });
    expect(screen.getByRole('button', { name: 'Add Gel polish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About Gel polish' })).not.toBeInTheDocument();
  });

  it('shows no ⓘ for a catalog cached before the texts existed', () => {
    const { details: _details, ...cached } = gel;
    renderRow(cached);
    expect(screen.queryByRole('button', { name: 'About Gel polish' })).not.toBeInTheDocument();
  });

  it('falls back like other texts: a Romanian-only text shows in English too', async () => {
    const user = userEvent.setup();
    renderRow({ ...gel, details: { ro: 'Pregătim unghiile.', ru: '', en: '' } });
    await user.click(screen.getByRole('button', { name: 'About Gel polish' }));
    const sheet = await screen.findByRole('dialog', { name: 'Gel polish' });
    expect(within(sheet).getByText('Pregătim unghiile.')).toBeInTheDocument();
  });
});
