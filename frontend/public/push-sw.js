/*
 * Nails by Alynna: Web Push for the installed app.
 *
 * Loaded into the service worker that vite-plugin-pwa generates (workbox.importScripts in
 * vite.config.ts), so it only runs in production builds; the dev server has no service worker.
 * The API sends { title, body, url, tag } (backend/src/lib/push.ts).
 */
/* eslint-disable */

var NBA_ICON = '/icons/pwa-192x192.png';
// Monochrome nail silhouette for the Android status bar (badges are drawn as a mask).
var NBA_BADGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAABR1BMVEVMaXH////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////hXQZ7AAAAbHRSTlMANe8B7i4r2f6W9XzXPblf4vQSD/sqmfoZl/mdjBdo6USY2xTEt+S/oymtJoDoe/cDttwcDvjnsfDtzAfH/J6in9X2/S0b7F66BSxNS8AIrKiLZcvmEMJkGHNcM7jfMnZRMNIVCdSKYyNPpChPkVm7AAAACXBIWXMAAAsTAAALEwEAmpwYAAABj0lEQVRo3u3WVW/DMBQF4HK7MqwrjJmZmZmZmTf//+fNkxOta24s+bov0z1v5+V8UmLFcTgolH+VdGgtHgzGo6H2ksxHtpmZ1oj2+VRbgP1KYHZI777Pz/7E79O5f7/CiuJy6ttf8jCLjG/o2k8OMMtcN+rZd18xIP1uLcABA/OqYz87BgOuMw1ABbNJDr/fmbEDyj/RwByzTSV2/7HXHhiuRgIhJkkPEvDLgAbcvpNJc4kC9uXACwp4lgMPmP1l85aJriYgYRABxMwb7MaRngeAGAKoN0aav8sT8NEoQwATxsiWzZE6VN/fyYuN7j5eZ6yB/KQy4C14CsdB4CWoX/93xsQmb6fQMXpXBm7FwmKStz0IOFcGcmIh/HM110KA+jHqEAujBS+kKLvKQJNYqOLlAgRO0N/qGl66QCCsDIyIhTpePkDgSBkw/hi9vEyBgEcZWBALb/Z3W0IZmBYLWV5a4H8XZcBYSPHigu8cNLDOS6aEgCwEEEAAAQQQQAABBBBAAAEEEEAAAQRQKNryBb400TKHxS6KAAAAAElFTkSuQmCC';

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : '' };
  }
  var title = typeof data.title === 'string' && data.title ? data.title : 'Nails by Alynna';
  var tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  var options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: NBA_ICON,
    badge: NBA_BADGE,
    data: { url: typeof data.url === 'string' && data.url ? data.url : '/' },
    timestamp: Date.now(),
  };
  if (tag) {
    // A newer message about the same visit replaces the older one, and still alerts.
    options.tag = tag;
    options.renotify = true;
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // An open app fetches what it shows again at once (lib/liveUpdates.ts).
      self.clients.matchAll({ type: 'window' }).then(function (windows) {
        for (var i = 0; i < windows.length; i++) windows[i].postMessage({ type: 'nba:push', tag: tag || null });
      }),
    ]),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var wanted = (event.notification.data && event.notification.data.url) || '/';
  var target = new URL(wanted, self.location.origin);
  // Only ever open this app.
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        if (new URL(client.url).origin !== self.location.origin) continue;
        // The app is open: bring it to the front on the right screen.
        return client.focus().then(function (focused) {
          var win = focused || client;
          if (win.url === target.href || typeof win.navigate !== 'function') return win;
          return win.navigate(target.href).catch(function () {
            return win;
          });
        });
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// The browser replaced the subscription (keys rotated or expired): register the new one.
self.addEventListener('pushsubscriptionchange', function (event) {
  var old = event.oldSubscription;
  var key = old && old.options ? old.options.applicationServerKey : null;
  var ready = event.newSubscription
    ? Promise.resolve(event.newSubscription)
    : key
      ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      : Promise.resolve(null);

  event.waitUntil(
    ready
      .then(function (subscription) {
        if (!subscription) return;
        var body = JSON.stringify(subscription.toJSON());
        var send = function () {
          return fetch('/api/notifications/push/subscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: body,
          });
        };
        return send().then(function (response) {
          if (response.status !== 401) return response;
          // The 15-minute access cookie ran out: refresh the session once, then retry.
          return fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' }).then(send);
        });
      })
      .catch(function () {
        /* Signed out or offline: the Notifications screen re-registers the device later. */
      }),
  );
});
