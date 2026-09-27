import more from '@/assets/install/install-ios-1-more.webp?no-inline';
import shareEn from '@/assets/install/install-ios-2-share-en.webp?no-inline';
import shareRo from '@/assets/install/install-ios-2-share-ro.webp?no-inline';
import shareRu from '@/assets/install/install-ios-2-share-ru.webp?no-inline';
import addEn from '@/assets/install/install-ios-3-add-en.webp?no-inline';
import addRo from '@/assets/install/install-ios-3-add-ro.webp?no-inline';
import addRu from '@/assets/install/install-ios-3-add-ru.webp?no-inline';
import confirmEn from '@/assets/install/install-ios-4-confirm-en.webp?no-inline';
import confirmRo from '@/assets/install/install-ios-4-confirm-ro.webp?no-inline';
import confirmRu from '@/assets/install/install-ios-4-confirm-ru.webp?no-inline';
import home from '@/assets/install/install-ios-5-home.webp?no-inline';
import type { Locale } from '@/i18n/config';

/** Where the control to tap sits on a picture, in percent of its width and height. */
export interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'circle' | 'pill' | 'icon';
}

export interface Shot {
  src: string;
  /** Pixel size (2x): the picture is shown at half of it at most, so it never blurs. */
  width: number;
  height: number;
  mark: Mark;
}

/*
 * Our own screenshots of this app in Safari on iOS 26.5 (iPhone 17 Pro simulator), one set per
 * iPhone language, cropped to the part that matters. Only the URLs live here: an image is fetched
 * when its step is on screen, so only the chosen device's pictures ever load (and none of them is
 * precached for the installed app, see vite.config.ts).
 */
const MORE: Shot = { src: more, width: 804, height: 160, mark: { x: 78.11, y: 12.92, w: 14.26, h: 71.67, shape: 'circle' } };
const HOME: Shot = { src: home, width: 431, height: 233, mark: { x: 13.16, y: 11.14, w: 31.58, h: 58.86, shape: 'icon' } };
const share = (src: string, y: number): Shot => ({ src, width: 804, height: 320, mark: { x: 31.92, y, w: 57.21, h: 24.58, shape: 'pill' } });
const add = (src: string, y: number): Shot => ({ src, width: 804, height: 440, mark: { x: 5.14, y, w: 89.39, h: 19.7, shape: 'pill' } });
const confirm = (src: string, x: number, w: number): Shot => ({ src, width: 804, height: 540, mark: { x, y: 6.54, w, h: 16.79, shape: 'pill' } });

export const IOS_SHOTS: Record<Locale, readonly Shot[]> = {
  ro: [MORE, share(shareRo, 13.54), add(addRo, 72.88), confirm(confirmRo, 69.32, 27.36), HOME],
  ru: [MORE, share(shareRu, 16.46), add(addRu, 71.82), confirm(confirmRu, 67.83, 28.86), HOME],
  en: [MORE, share(shareEn, 14.17), add(addEn, 72.88), confirm(confirmEn, 79.6, 17.08), HOME],
};
