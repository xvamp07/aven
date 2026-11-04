/* FitLog service worker.
   Job: keep a complete copy of the app files so FitLog opens with no connection.
   It never reads or writes the database or any user data. */

importScripts('./version.js');

const VERSION = self.APP_VERSION;
const CACHE_PREFIX = 'fitlog-shell-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

/* Every file the app needs. If you add a file to the project, add it here too. */
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './version.js',
  './manifest.webmanifest',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/diagnostics.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const urlFor = (path) => new URL(path, self.registration.scope).href;

/* Install: download every file. If any file fails, the whole install fails
   and the previous version keeps working. */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async (path) => {
      const url = urlFor(path);
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error('Could not store ' + url + ' (HTTP ' + response.status + ')');
      await cache.put(url, response);
    }));
    /* No skipWaiting here on purpose: the new version waits until you tap
       "Apply update", so it never swaps files while you are logging. */
  })());
});

/* Activate: remove copies from older versions. */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
           .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

/* Fetch: files of this app come from the stored copy first.
   Requests to other sites are not touched. */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const stored = await cache.match(request, { ignoreSearch: true });
    if (stored) return stored;
    if (request.mode === 'navigate') {
      const shell = await cache.match(urlFor('./index.html'));
      if (shell) return shell;
    }
    return fetch(request);
  })());
});

/* Messages from the page. */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'GET_STATUS' && event.ports && event.ports[0]) {
    const port = event.ports[0];
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      port.postMessage({
        version: VERSION,
        cacheName: CACHE_NAME,
        expected: ASSETS.length,
        cached: keys.length,
      });
    })());
  }
});
