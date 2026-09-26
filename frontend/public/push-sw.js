/*
 * Nails by Alynna: Web Push for the installed app.
 *
 * Loaded into the service worker that vite-plugin-pwa generates (workbox.importScripts in
 * vite.config.ts), so it only runs in production builds; the dev server has no service worker.
 * The API sends { title, body, url, tag, lang, timestamp }, plus the same message in the
 * Declarative Web Push format ({ web_push: 8030, notification: { title, body, navigate, … } },
 * backend/src/lib/push.ts), which Safari 18.4+ shows by itself if this worker can't run.
 *
 * Every push shows a notification, whatever arrives (broken or empty payloads included):
 * Safari takes notifications away from an app that receives a push without showing one.
 * Tested in src/lib/pushWorker.test.ts.
 */
/* eslint-disable */

var NBA_APP_NAME = 'Nails by Alynna';
var NBA_ICON = '/icons/pwa-192x192.png';
// Monochrome nail silhouette for the Android status bar (badges are drawn as a mask).
var NBA_BADGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAABR1BMVEVMaXH////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////hXQZ7AAAAbHRSTlMANe8B7i4r2f6W9XzXPblf4vQSD/sqmfoZl/mdjBdo6USY2xTEt+S/oymtJoDoe/cDttwcDvjnsfDtzAfH/J6in9X2/S0b7F66BSxNS8AIrKiLZcvmEMJkGHNcM7jfMnZRMNIVCdSKYyNPpChPkVm7AAAACXBIWXMAAAsTAAALEwEAmpwYAAABj0lEQVRo3u3WVW/DMBQF4HK7MqwrjJmZmZmZmTf//+fNkxOta24s+bov0z1v5+V8UmLFcTgolH+VdGgtHgzGo6H2ksxHtpmZ1oj2+VRbgP1KYHZI777Pz/7E79O5f7/CiuJy6ttf8jCLjG/o2k8OMMtcN+rZd18xIP1uLcABA/OqYz87BgOuMw1ABbNJDr/fmbEDyj/RwByzTSV2/7HXHhiuRgIhJkkPEvDLgAbcvpNJc4kC9uXACwp4lgMPmP1l85aJriYgYRABxMwb7MaRngeAGAKoN0aav8sT8NEoQwATxsiWzZE6VN/fyYuN7j5eZ6yB/KQy4C14CsdB4CWoX/93xsQmb6fQMXpXBm7FwmKStz0IOFcGcmIh/HM110KA+jHqEAujBS+kKLvKQJNYqOLlAgRO0N/qGl66QCCsDIyIhTpePkDgSBkw/hi9vEyBgEcZWBALb/Z3W0IZmBYLWV5a4H8XZcBYSPHigu8cNLDOS6aEgCwEEEAAAQQQQAABBBBAAAEEEEAAAQRQKNryBb400TKHxS6KAAAAAElFTkSuQmCC';
// Shown when a push arrives without readable words (in the language of the message or the phone).
var NBA_FALLBACK_BODY = {
  ro: 'Ai o noutate. Atinge ca să deschizi aplicația.',
  ru: 'У вас новое уведомление. Нажмите, чтобы открыть приложение.',
  en: 'You have a new update. Tap to open the app.',
};

function nbaText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nbaLang(value) {
  var lang = (nbaText(value) || (self.navigator && self.navigator.language) || '').slice(0, 2).toLowerCase();
  return NBA_FALLBACK_BODY[lang] ? lang : 'ro';
}

/** What to show for this push: the API's JSON, the declarative format, plain text or nothing at all. */
function nbaReadPush(event) {
  var data = null;
  var text = '';
  if (event.data) {
    try {
      data = event.data.json();
    } catch (error) {
      try {
        text = event.data.text();
      } catch (ignored) {
        text = '';
      }
    }
  }
  if (!data || typeof data !== 'object') data = {};
  var declared = data.notification && typeof data.notification === 'object' ? data.notification : {};
  var lang = nbaLang(data.lang || declared.lang);
  var tag = nbaText(data.tag) || nbaText(declared.tag);
  var timestamp = Number(data.timestamp || declared.timestamp);
  var options = {
    body: nbaText(data.body) || nbaText(declared.body) || nbaText(text).slice(0, 300) || NBA_FALLBACK_BODY[lang],
    icon: NBA_ICON,
    badge: NBA_BADGE,
    lang: lang,
    data: { url: nbaText(data.url) || nbaText(declared.navigate) || '/' },
    // When it happened, not when a phone that was offline finally got it.
    timestamp: timestamp > 0 ? timestamp : Date.now(),
  };
  if (tag) {
    // A newer message about the same visit replaces the older one, and still alerts.
    options.tag = tag;
    options.renotify = true;
  }
  return { title: nbaText(data.title) || nbaText(declared.title) || NBA_APP_NAME, options: options, tag: tag || null };
}

function nbaShow(title, options) {
  return self.registration.showNotification(title, options).catch(function (error) {
    // An option was refused: the words alone still have to show.
    console.error('[push] notification refused, showing a plain one', error);
    return self.registration.showNotification(title, { body: options.body, data: options.data });
  });
}

self.addEventListener('push', function (event) {
  var shown;
  try {
    shown = nbaReadPush(event);
  } catch (error) {
    console.error('[push] unreadable push', error);
    shown = { title: NBA_APP_NAME, options: { body: NBA_FALLBACK_BODY[nbaLang()], icon: NBA_ICON, data: { url: '/' } }, tag: null };
  }
  event.waitUntil(
    Promise.all([
      nbaShow(shown.title, shown.options),
      // An open app fetches what it shows again at once (lib/liveUpdates.ts).
      self.clients
        .matchAll({ type: 'window' })
        .then(function (windows) {
          for (var i = 0; i < windows.length; i++) windows[i].postMessage({ type: 'nba:push', tag: shown.tag });
        })
        .catch(function () {
          /* Nothing open to refresh. */
        }),
    ]),
  );
});

function nbaSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch (error) {
    return false;
  }
}

/** The page to open: the notification's link, only ever inside this app. */
function nbaTarget(url) {
  try {
    var target = new URL(url || '/', self.location.origin);
    if (target.origin === self.location.origin) return target.href;
  } catch (error) {
    /* Not a URL: open the app. */
  }
  return new URL('/', self.location.origin).href;
}

/** Moves an open window to `href`: navigate() when it can, else the app routes there itself. */
function nbaGo(win, href) {
  if (win.url === href) return Promise.resolve(win);
  var ask = function () {
    win.postMessage({ type: 'nba:navigate', url: href });
    return win;
  };
  if (typeof win.navigate !== 'function') return Promise.resolve(ask());
  return win.navigate(href).then(
    function (navigated) {
      return navigated || win;
    },
    ask,
  );
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var href = nbaTarget(event.notification.data && event.notification.data.url);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      var mine = [];
      for (var i = 0; i < windows.length; i++) if (nbaSameOrigin(windows[i].url)) mine.push(windows[i]);
      var pick = function (test) {
        for (var j = 0; j < mine.length; j++) if (test(mine[j])) return mine[j];
        return null;
      };
      // The app is open: bring it to the front (the window already on that page, else the one in use), on the right page.
      var client =
        pick(function (w) {
          return w.url === href;
        }) ||
        pick(function (w) {
          return w.focused;
        }) ||
        pick(function (w) {
          return w.visibilityState === 'visible';
        }) ||
        mine[0];
      if (!client) return self.clients.openWindow(href);
      return client.focus().then(
        function (focused) {
          return nbaGo(focused || client, href);
        },
        function () {
          // Focusing was refused: open the page instead.
          return self.clients.openWindow(href);
        },
      );
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
      .catch(function (error) {
        // Signed out or offline: the Notifications screen re-registers the device later.
        console.warn('[push] could not register the renewed subscription', error);
      }),
  );
});
