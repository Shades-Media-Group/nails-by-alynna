import type { GeoPoint } from '../db/types';

/** Google Maps directions to a point, from wherever the reader is; phones open the Maps app. */
export function googleDirectionsUrl(point: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
}

/** The iCalendar GEO property (RFC 5545 §3.8.1.6): latitude and longitude, `;` between. */
export function icsGeo(point: GeoPoint): string {
  return `GEO:${point.lat};${point.lng}`;
}
