import { describe, expect, it } from 'vitest';
import { directionsApps, directionsUrl, formatCoordinates, parseCoordinates } from './directions';

const STUDIO = { lat: 47.063205, lng: 28.844794 };

describe('directions to the studio', () => {
  it("hands the pin to each app's own link, which phones open in the app", () => {
    expect(directionsUrl('google', STUDIO, 'android')).toBe('https://www.google.com/maps/dir/?api=1&destination=47.063205,28.844794');
    expect(directionsUrl('apple', STUDIO, 'ios')).toBe('https://maps.apple.com/directions?destination=47.063205,28.844794');
    expect(directionsUrl('waze', STUDIO, 'android')).toBe('https://waze.com/ul?ll=47.063205,28.844794&navigate=yes');

    const taxi = new URL(directionsUrl('yandexGo', STUDIO, 'ios'));
    expect(taxi.origin + taxi.pathname).toBe('https://3.redirect.appmetrica.yandex.com/route');
    expect(taxi.searchParams.get('end-lat')).toBe('47.063205');
    expect(taxi.searchParams.get('end-lon')).toBe('28.844794');
    // No app: its store page on a phone, the website on a computer.
    expect(taxi.searchParams.get('appmetrica_tracking_id')).toBe('1178268795219780156');
    expect(new URL(directionsUrl('yandexGo', STUDIO, 'desktop')).searchParams.get('appmetrica_tracking_id')).toBe('25395763362139037');
  });

  it("offers the phone's own maps first, and a taxi only on a phone", () => {
    expect(directionsApps('ios')).toEqual(['apple', 'google', 'waze', 'yandexGo']);
    expect(directionsApps('ipados')).toEqual(['apple', 'google', 'waze', 'yandexGo']);
    expect(directionsApps('android')).toEqual(['google', 'waze', 'yandexGo']);
    expect(directionsApps('desktop')).toEqual(['google', 'apple', 'waze']);
  });
});

describe('the pin in Settings', () => {
  it('reads what Google Maps copies, and a Maps link with the pin in it', () => {
    expect(parseCoordinates('47.063205, 28.844794')).toEqual(STUDIO);
    expect(parseCoordinates(' 47.063205,28.844794 ')).toEqual(STUDIO);
    expect(parseCoordinates('47.0632051234; 28.8447941234')).toEqual(STUDIO);
    expect(parseCoordinates('https://www.google.com/maps/@47.063205,28.844794,17z')).toEqual(STUDIO);
    expect(parseCoordinates('-33.8568, 151.2153')).toEqual({ lat: -33.8568, lng: 151.2153 });
  });

  it('refuses anything that is not a place on Earth', () => {
    for (const text of ['', 'Chișinău', '47.06', '91, 28', '47, 181', 'abc, def']) expect(parseCoordinates(text), text).toBeNull();
  });

  it('shows the pin as Google Maps does', () => {
    expect(formatCoordinates(STUDIO)).toBe('47.063205, 28.844794');
  });
});
