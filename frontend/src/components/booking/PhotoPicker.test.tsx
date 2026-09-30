import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import type * as photosModule from '@/lib/photos';
import { fitWithin, toBase64 } from '@/lib/photos';
import { PhotoPicker } from './PhotoPicker';
import { clearBookingPhotos, useBookingPhotos } from './useBookingPhotos';

const uploads: Array<{ image: string; thumb: string }> = [];
const removed: string[] = [];

vi.mock('@/lib/photos', async (importOriginal) => {
  const actual = await importOriginal<typeof photosModule>();
  return {
    ...actual,
    preloadPhotoEncoder: () => undefined,
    compressPhoto: vi.fn(async (file: File) => {
      if (file.name.endsWith('.heic')) throw new actual.PhotoFormatError();
      return { image: new Uint8Array([1, 2, 3]), thumb: new Uint8Array([4]), width: 1600, height: 1200 };
    }),
  };
});
vi.mock('@/services/api/endpoints', () => ({
  photosApi: {
    upload: vi.fn(async (input: { image: string; thumb: string }) => {
      uploads.push(input);
      return { id: `ph${uploads.length}`, url: '', thumbUrl: '', width: 1600, height: 1200, size: 4, createdAt: '' };
    }),
    remove: vi.fn(async (id: string) => {
      removed.push(id);
      return { ok: true };
    }),
  },
}));

beforeEach(() => {
  clearBookingPhotos();
  uploads.length = 0;
  removed.length = 0;
  let n = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:photo-${++n}`, revokeObjectURL: () => undefined }));
});
afterEach(() => vi.unstubAllGlobals());

const file = (name: string) => new File([new Uint8Array([9])], name, { type: name.endsWith('.heic') ? 'image/heic' : 'image/jpeg' });

describe('photo helpers', () => {
  it('fit a photo within 1600 px, never enlarging', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('send bytes as base64', () => {
    expect(toBase64(new Uint8Array([0, 1, 2, 250, 255]))).toBe(btoa(String.fromCharCode(0, 1, 2, 250, 255)));
  });
});

describe('booking photos', () => {
  it('are made small and sent as soon as they are picked, three at most', async () => {
    const { result } = renderHook(() => useBookingPhotos());
    act(() => result.current.add([file('a.jpg'), file('b.jpg')]));
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.ids).toEqual(['ph1', 'ph2']));
    expect(result.current.busy).toBe(false);
    expect(uploads[0]).toEqual({ image: btoa(String.fromCharCode(1, 2, 3)), thumb: btoa(String.fromCharCode(4)) });

    act(() => result.current.add([file('c.jpg'), file('d.jpg')]));
    await waitFor(() => expect(result.current.ids).toHaveLength(3));
    expect(result.current.photos).toHaveLength(3);

    // Removing one already sent deletes it at the studio too.
    act(() => result.current.remove(result.current.photos[0]!.key));
    expect(result.current.ids).toEqual(['ph2', 'ph3']);
    expect(removed).toEqual(['ph1']);
  });

  it('go on from the price list to the booking, and belong to the account that added them', async () => {
    const onServices = renderHook(() => useBookingPhotos('u1'));
    act(() => onServices.result.current.add([file('a.jpg')]));
    onServices.unmount();
    // The booking opens while the photo is still on its way; it arrives there.
    const onBooking = renderHook(() => useBookingPhotos('u1'));
    await waitFor(() => expect(onBooking.result.current.ids).toEqual(['ph1']));

    // Another account on this phone doesn't see them, and starts its own.
    const other = renderHook(() => useBookingPhotos('u2'));
    expect(other.result.current.photos).toEqual([]);
    act(() => other.result.current.add([file('b.jpg')]));
    await waitFor(() => expect(other.result.current.ids).toEqual(['ph2']));

    // Once a booking is made, the next one starts without photos.
    act(() => clearBookingPhotos('u2'));
    expect(other.result.current.photos).toEqual([]);
  });

  it('say so when a photo cannot be read, and never send it', async () => {
    const i18n = i18next.createInstance();
    void i18n.use(initReactI18next).init({
      lng: 'en',
      ns: ['booking', 'common'],
      defaultNS: 'booking',
      resources: { en: { booking, common } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
    const user = userEvent.setup();
    function Harness() {
      const photos = useBookingPhotos();
      return <PhotoPicker photos={photos.photos} onAdd={photos.add} onRemove={photos.remove} />;
    }
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Photos of the nails you like' })).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [file('ok.jpg'), file('odd.heic')]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be read/);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add another/ })).toBeInTheDocument();
  });
});
