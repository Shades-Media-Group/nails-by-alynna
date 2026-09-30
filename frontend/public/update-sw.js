/*
 * Nails by Alynna: every open app moves to a new version as soon as it is out.
 *
 * Loaded into the service worker that vite-plugin-pwa generates (workbox.importScripts in
 * vite.config.ts, before Workbox's own code). The new worker takes over as soon as it is installed
 * (skipWaiting), then every window that was open on an older version is moved to it:
 *  - a window of a version that knows this message answers it and updates itself when nothing is in
 *    the way (components/common/UpdatePrompt.tsx);
 *  - one that does not answer (an app installed before this existed, or asleep in the background)
 *    is reloaded here, so phones with the app already installed get the new version too.
 * A first visit (a window no worker controlled yet) is only claimed, never reloaded.
 * Tested in src/lib/updateWorker.test.ts.
 */
/* eslint-disable */

var NBA_UPDATE_MESSAGE = 'nba:update-ready';
/** How long a window has to say it updates itself. */
var NBA_ANSWER_MS = 1500;

/** Whether the window's own code takes the update (it answers on the channel). */
function nbaUpdatesItself(win) {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (value) {
      if (done) return;
      done = true;
      resolve(value);
    };
    try {
      var channel = new MessageChannel();
      channel.port1.onmessage = function () {
        finish(true);
      };
      win.postMessage({ type: NBA_UPDATE_MESSAGE }, [channel.port2]);
    } catch (error) {
      finish(false);
      return;
    }
    setTimeout(function () {
      finish(false);
    }, NBA_ANSWER_MS);
  });
}

function nbaReload(win) {
  if (typeof win.navigate !== 'function') return Promise.resolve();
  return win.navigate(win.url).catch(function () {
    /* The window closed meanwhile. */
  });
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    // Windows this registration already controls: open on an older version (a first visit is not
    // controlled yet). Taken before claiming, so a first visit is never reloaded.
    self.clients
      .matchAll({ type: 'window' })
      .then(function (older) {
        return self.clients.claim().then(function () {
          return Promise.all(
            older.map(function (win) {
              return nbaUpdatesItself(win).then(function (itself) {
                return itself ? null : nbaReload(win);
              });
            }),
          );
        });
      })
      .catch(function (error) {
        console.warn('[update] could not move open windows to the new version', error);
      }),
  );
});
