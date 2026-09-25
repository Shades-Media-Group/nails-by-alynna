import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 15; SM-A556B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/500.0.0.0;]',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
};

describe('detectPlatform', () => {
  it('recognises iPhone browsers and in-app browsers', () => {
    expect(detectPlatform(UA.iphoneSafari)).toMatchObject({ os: 'ios', browser: 'safari', inApp: null, mobile: true });
    expect(detectPlatform(UA.iphoneChrome)).toMatchObject({ os: 'ios', browser: 'chrome' });
    expect(detectPlatform(UA.iphoneInstagram)).toMatchObject({ os: 'ios', inApp: 'instagram' });
  });

  it('treats a touch "Mac" as an iPad', () => {
    expect(detectPlatform(UA.ipad, { maxTouchPoints: 5 })).toMatchObject({ os: 'ipados', mobile: true });
    expect(detectPlatform(UA.ipad, { maxTouchPoints: 0 })).toMatchObject({ os: 'desktop', mobile: false });
  });

  it('recognises Android browsers', () => {
    expect(detectPlatform(UA.androidChrome)).toMatchObject({ os: 'android', browser: 'chrome', inApp: null });
    expect(detectPlatform(UA.androidSamsung)).toMatchObject({ os: 'android', browser: 'samsung' });
    expect(detectPlatform(UA.androidFacebook)).toMatchObject({ os: 'android', inApp: 'facebook' });
  });

  it('treats laptops and desktops as desktop', () => {
    expect(detectPlatform(UA.macChrome)).toMatchObject({ os: 'desktop', browser: 'chrome', mobile: false });
    expect(detectPlatform(UA.windowsEdge)).toMatchObject({ os: 'desktop', browser: 'edge' });
  });
});
