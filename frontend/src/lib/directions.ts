import { currentPlatform, type OS } from '@/lib/platform';
import type { GeoPoint } from '@/types/api';

/*
 * "Getting there": the studio's pin handed to the app the client already uses. Every link is the
 * app's own documented web link, which phones open in the app when it is installed (and in the
 * browser, or the app's store page, when it is not):
 *  - Google Maps: Maps URLs, `/maps/dir/?api=1&destination=`
 *  - Apple Maps: unified Maps URLs (iOS 18.4+, macOS 15.4+), `/directions?destination=`; the older
 *    `?daddr=lat,lng` form no longer routes to a coordinate on current iOS
 *  - Waze: deep links, `/ul?ll=…&navigate=yes`
 *  - Yandex Go: the taxi order link (`end-lat`/`end-lon` on the AppMetrica redirect), app code 3
 */

export type DirectionsApp = 'apple' | 'google' | 'waze' | 'yandexGo';

/** Yandex Go's redirect when the app is missing: its store page on a phone, its website on a computer. */
const YANDEX_GO_TRACKING = { store: '1178268795219780156', web: '25395763362139037' } as const;

const pair = (point: GeoPoint) => `${point.lat},${point.lng}`;

export function directionsUrl(app: DirectionsApp, point: GeoPoint, os: OS = currentPlatform().os): string {
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${pair(point)}`;
    case 'apple':
      return `https://maps.apple.com/directions?destination=${pair(point)}`;
    case 'waze':
      return `https://waze.com/ul?ll=${pair(point)}&navigate=yes`;
    case 'yandexGo': {
      const params = new URLSearchParams({
        'end-lat': String(point.lat),
        'end-lon': String(point.lng),
        ref: 'nailsbyalynna',
        appmetrica_tracking_id: os === 'desktop' ? YANDEX_GO_TRACKING.web : YANDEX_GO_TRACKING.store,
      });
      return `https://3.redirect.appmetrica.yandex.com/route?${params.toString()}`;
    }
  }
}

/**
 * The apps to offer here, the phone's own first. iPhone and iPad: Apple Maps, then the others.
 * Android: Google Maps, Waze, a taxi. A computer: the maps only (a taxi is ordered from a phone).
 */
export function directionsApps(os: OS = currentPlatform().os): DirectionsApp[] {
  if (os === 'ios' || os === 'ipados') return ['apple', 'google', 'waze', 'yandexGo'];
  if (os === 'android') return ['google', 'waze', 'yandexGo'];
  return ['google', 'apple', 'waze'];
}

/** "47.063205, 28.844794", as Google Maps shows a dropped pin. */
export function formatCoordinates(point: GeoPoint): string {
  return `${point.lat}, ${point.lng}`;
}

/**
 * A pin from what the owner pastes: "47.063205, 28.844794" (Google Maps copies it so), with or
 * without the space, or a Google Maps link with "@47.06,28.84" or "?q=47.06,28.84" in it.
 */
export function parseCoordinates(text: string): GeoPoint | null {
  const match = /(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
