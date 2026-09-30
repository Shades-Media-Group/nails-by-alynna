/*
 * Booking photos, made small on the phone before they are sent: the studio's server has 1 GB in
 * all, and a nail photo straight from a phone camera is 3–6 MB. The picture is
 *  1. decoded (turned upright; iPhone HEIC photos arrive as JPEG from the photo picker),
 *  2. shrunk to at most 1600 px on its long side, halving step by step with high-quality
 *     smoothing (one big jump would blur the fine lines of a design),
 *  3. encoded as WebP with libwebp (the codec Chrome uses, here as WebAssembly so every phone
 *     gets the same result) at quality 85 with light smoothing, so fine texture and the lines of
 *     a design survive; "sharp YUV" keeps colour edges crisp. Only a very detailed photo is
 *     stepped down (80, 75, 70 at the least) to stay under about 240 KB; one still above that
 *     (a field of tiny flowers) is made 1280 px instead, keeping each pixel sharp,
 *  4. with a 360 px thumbnail for lists.
 * Measured on phone photos: 2.5 MB → 120 KB, 1.8 MB (dense texture) → 230 KB, next to no visible
 * difference from the lossless picture at 1600 px. Location and camera data are gone with the
 * re-encoding.
 */

export const PHOTO_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 360;
/** Aim for photos under this size; the API refuses above 700 KB. */
const TARGET_BYTES = 240 * 1024;
const QUALITIES = [85, 80, 75, 70];
/** The rare photo still above the target at 70 is made 1280 px instead, at a quality kept high. */
const FALLBACK_MAX_SIDE = 1280;
const FALLBACK_QUALITIES = [80, 72];
const THUMB_QUALITY = 70;

export interface CompressedPhoto {
  image: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
}

export class PhotoFormatError extends Error {
  constructor() {
    super('This photo could not be read');
    this.name = 'PhotoFormatError';
  }
}

/** The size that fits in `max` on the long side, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

function context(surface: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = surface.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new PhotoFormatError();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** `source` shrunk to width × height, halving until close, so detail stays sharp. */
function shrink(source: CanvasImageSource & { width: number; height: number }, width: number, height: number): ImageData {
  let current: CanvasImageSource & { width: number; height: number } = source;
  let w = source.width;
  let h = source.height;
  while (w / 2 >= width && h / 2 >= height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = canvas(w, h);
    context(step).drawImage(current, 0, 0, w, h);
    current = step;
  }
  const out = canvas(width, height);
  const ctx = context(out);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(current, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

async function encoder() {
  const { default: encode } = await import('@jsquash/webp/encode');
  return (data: ImageData, quality: number) =>
    encode(data, { quality, method: 4, use_sharp_yuv: 1, sns_strength: 50, filter_strength: 20 }).then((buffer) => new Uint8Array(buffer));
}

/** Loads the encoder ahead of the first photo (when the picker shows), so adding one feels instant. */
export function preloadPhotoEncoder(): void {
  void import('@jsquash/webp/encode').catch(() => undefined);
}

/** The photo as it will be sent: small WebP and thumbnail. */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoFormatError();
  }
  try {
    const thumbSize = fitWithin(bitmap.width, bitmap.height, THUMB_MAX_SIDE);
    const encode = await encoder();
    let size = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_SIDE);
    let pixels = shrink(bitmap, size.width, size.height);
    let image = await encode(pixels, QUALITIES[0]!);
    for (const quality of QUALITIES.slice(1)) {
      if (image.length <= TARGET_BYTES) break;
      image = await encode(pixels, quality);
    }
    // Still big (a dense pattern, a field of tiny flowers): fewer pixels, each kept sharp, rather
    // than a lower quality that would smear them.
    if (image.length > TARGET_BYTES) {
      size = fitWithin(bitmap.width, bitmap.height, FALLBACK_MAX_SIDE);
      pixels = shrink(bitmap, size.width, size.height);
      for (const quality of FALLBACK_QUALITIES) {
        image = await encode(pixels, quality);
        if (image.length <= TARGET_BYTES) break;
      }
    }
    const thumb = await encode(shrink(bitmap, thumbSize.width, thumbSize.height), THUMB_QUALITY);
    return { image, thumb, ...size };
  } finally {
    bitmap.close();
  }
}

/** Bytes as base64, for the JSON upload. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
