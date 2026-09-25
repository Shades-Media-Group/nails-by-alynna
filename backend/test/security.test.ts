import { describe, expect, it } from 'vitest';
import { isLanDevOrigin } from '../src/middleware/security';

describe('isLanDevOrigin (development only)', () => {
  const app = 'http://localhost:5180';

  it('accepts the dev server opened from a private address on the same port', () => {
    expect(isLanDevOrigin('http://192.168.18.223:5180', app)).toBe(true);
    expect(isLanDevOrigin('http://10.0.0.5:5180', app)).toBe(true);
    expect(isLanDevOrigin('http://172.20.1.2:5180', app)).toBe(true);
    expect(isLanDevOrigin('http://127.0.0.1:5180', app)).toBe(true);
  });

  it('refuses other ports, https, public addresses and garbage', () => {
    expect(isLanDevOrigin('http://192.168.1.2:3000', app)).toBe(false);
    expect(isLanDevOrigin('https://192.168.1.2:5180', app)).toBe(false);
    expect(isLanDevOrigin('http://8.8.8.8:5180', app)).toBe(false);
    expect(isLanDevOrigin('http://172.32.0.1:5180', app)).toBe(false);
    expect(isLanDevOrigin('http://evil.example:5180', app)).toBe(false);
    expect(isLanDevOrigin('not a url', app)).toBe(false);
  });
});
