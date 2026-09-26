import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PUSH_MESSAGE_BYTES,
  encodePushMessage,
  isValidTopic,
  pushDeviceOf,
  pushServiceOf,
  subscriptionGone,
  vapidAuthorizer,
  webPushTransport,
  type PushSendOptions,
} from '../src/lib/push';

/*
 * The Web Push wire format and the push-service rules (Apple's in particular): what a phone
 * receives, the headers each message carries, and which refusals mean "forget this device".
 */

const vapid = webpush.generateVAPIDKeys();
const PUSH = { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: 'mailto:studio@example.com' };
const APP = 'https://nails.example.md';
const apple = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the message a phone receives', () => {
  it('carries what every service worker reads, and the declarative copy Safari can show by itself', () => {
    const message = JSON.parse(
      encodePushMessage(
        { title: 'Programare confirmată', body: 'Mâine, la 11:00', url: '/bookings/abc', tag: 'visit-abc', lang: 'ro', timestamp: 1_780_000_000_000 },
        APP,
      ),
    );
    expect(message).toEqual({
      title: 'Programare confirmată',
      body: 'Mâine, la 11:00',
      url: '/bookings/abc',
      tag: 'visit-abc',
      lang: 'ro',
      timestamp: 1_780_000_000_000,
      web_push: 8030,
      mutable: true,
      notification: {
        title: 'Programare confirmată',
        body: 'Mâine, la 11:00',
        navigate: 'https://nails.example.md/bookings/abc',
        tag: 'visit-abc',
        lang: 'ro',
        timestamp: 1_780_000_000_000,
        silent: false,
      },
    });
  });

  it('carries the count for the app icon when there is one, for the service worker and for Safari', () => {
    const counted = JSON.parse(encodePushMessage({ title: 'New booking request', body: 'Ana', url: '/admin', tag: 't', badge: 3 }, APP));
    expect(counted).toMatchObject({ badge: 3, app_badge: 3 });
    const cleared = JSON.parse(encodePushMessage({ title: 'x', body: 'y', url: '/admin', tag: 't', badge: 0 }, APP));
    expect(cleared).toMatchObject({ badge: 0, app_badge: 0 });
    for (const badge of [undefined, -1, 2.5]) {
      const message = JSON.parse(encodePushMessage({ title: 'x', body: 'y', url: '/', tag: 't', badge }, APP));
      expect(message).not.toHaveProperty('badge');
      expect(message).not.toHaveProperty('app_badge');
    }
  });

  it('never opens another site, and always has a title', () => {
    const message = JSON.parse(encodePushMessage({ title: '  ', body: 'x', url: 'https://evil.example.com/steal', tag: 't' }, APP));
    expect(message.notification.navigate).toBe('https://nails.example.md/');
    expect(message.title).toBe('Nails by Alynna');
    expect(message.notification.title).toBe('Nails by Alynna');
  });

  it('stays under the 4 KB push services accept, however long the text', () => {
    const long = 'Гель-лак с дизайном и укреплением '.repeat(200);
    const message = encodePushMessage({ title: long, body: long, url: '/bookings/abc', tag: 't', lang: 'ru' }, APP);
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(MAX_PUSH_MESSAGE_BYTES);
    const parsed = JSON.parse(message);
    expect(parsed.title).toHaveLength(120);
    expect(parsed.body.length).toBeGreaterThan(100);
    expect(parsed.notification.body).toBe(parsed.body);
  });
});

describe('sending to a push service', () => {
  const options: PushSendOptions = { ttlSec: 86_400, urgency: 'high', topic: 'b0123456789abcdef01234567' };

  it('sends TTL, Urgency, Topic and a VAPID token for that service', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const transport = webPushTransport(PUSH);

    expect(await transport.send(apple, '{"title":"x"}', options)).toEqual({ status: 201 });
    const sent = send.mock.calls[0]![2]!;
    expect(sent).toMatchObject({ TTL: 86_400, urgency: 'high', topic: 'b0123456789abcdef01234567', contentEncoding: 'aes128gcm' });
    expect(sent.headers!.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${PUSH.publicKey}$`));
    // A second message to the same service reuses the token.
    await transport.send(apple, '{}', options);
    expect(send.mock.calls[1]![2]!.headers!.Authorization).toBe(sent.headers!.Authorization);
  });

  it('drops a topic Apple would refuse instead of failing the message', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await webPushTransport(PUSH).send(apple, '{}', { ...options, topic: 'visit/abc:1' });
    expect(send.mock.calls[0]![2]!.topic).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('visit/abc:1'));
    // The topics the booking messages use are all valid: a letter and the visit's 24-hex id.
    expect(['b', 'r', 's'].every((p) => isValidTopic(`${p}${'a1'.repeat(12)}`))).toBe(true);
    expect(isValidTopic('test')).toBe(true);
    expect(isValidTopic('x'.repeat(33))).toBe(false);
  });

  it("hands back the push service's refusal with its reason, and throws network errors", async () => {
    const send = vi.spyOn(webpush, 'sendNotification');
    const transport = webPushTransport(PUSH);
    send.mockRejectedValueOnce(new webpush.WebPushError('Received unexpected response code', 403, {}, '{"reason":"BadJwtToken"}', apple.endpoint));
    expect(await transport.send(apple, '{}', options)).toEqual({ status: 403, body: '{"reason":"BadJwtToken"}' });
    send.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(transport.send(apple, '{}', options)).rejects.toThrow('socket hang up');
  });

  it('signs one token per push service and keeps it for hours (Apple: no more than one new token an hour)', () => {
    const start = Date.now();
    let now = start;
    const authorize = vapidAuthorizer(PUSH, () => now);
    const first = authorize('https://web.push.apple.com/device-a');
    expect(authorize('https://web.push.apple.com/device-b')).toBe(first);
    expect(authorize('https://fcm.googleapis.com/fcm/send/device-c')).not.toBe(first);
    now += 60 * 60_000;
    expect(authorize('https://web.push.apple.com/device-a')).toBe(first);
    now = start + 11 * 3_600_000;
    expect(authorize('https://web.push.apple.com/device-a')).not.toBe(first);

    const jwt = /^vapid t=([^,]+),/.exec(first)![1]!;
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { aud: string; sub: string; exp: number };
    expect(claims.aud).toBe('https://web.push.apple.com');
    expect(claims.sub).toBe(PUSH.subject);
    // Apple refuses tokens that expire more than a day ahead.
    expect(claims.exp - Math.floor(start / 1000)).toBeLessThanOrEqual(24 * 3600);
  });
});

describe('push services and devices', () => {
  it('names the push service and the kind of device', () => {
    expect(pushServiceOf('https://web.push.apple.com/abc')).toBe('apple');
    expect(pushServiceOf('https://fcm.googleapis.com/fcm/send/abc')).toBe('google');
    expect(pushServiceOf('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe('mozilla');
    expect(pushServiceOf('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe('microsoft');
    expect(pushServiceOf('not a url')).toBe('other');

    expect(pushDeviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15')).toBe('iphone');
    expect(pushDeviceOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36')).toBe('android');
    expect(pushDeviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15')).toBe('mac');
    expect(pushDeviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0')).toBe('windows');
    expect(pushDeviceOf('')).toBe('other');
  });

  it('forgets a subscription only when it can never work again', () => {
    expect(subscriptionGone(410, '')).toBe(true);
    expect(subscriptionGone(404, '')).toBe(true);
    expect(subscriptionGone(403, 'VapidPkHashMismatch')).toBe(true);
    // What web.push.apple.com answered this app's sender for a device token it doesn't know.
    expect(subscriptionGone(400, 'BadWebPushToken')).toBe(true);
    expect(subscriptionGone(403, 'the key in the authorization header does not correspond to the sender ID used to subscribe this user.')).toBe(true);
    // Our own problem, or a passing one: keep the device.
    expect(subscriptionGone(403, 'BadJwtToken')).toBe(false);
    expect(subscriptionGone(400, 'BadWebPushTopic')).toBe(false);
    expect(subscriptionGone(413, 'PayloadTooLarge')).toBe(false);
    expect(subscriptionGone(429, 'TooManyRequests')).toBe(false);
    expect(subscriptionGone(503, 'ServiceUnavailable')).toBe(false);
  });
});
