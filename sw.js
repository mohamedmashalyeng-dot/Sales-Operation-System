// Retirement worker for the removed legacy frontend.
// The Readdy/Vite app does not register a service worker. This file remains only so browsers
// that previously installed /sw.js can update once, clear legacy caches, and unregister.
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('pathway-') || key.startsWith('kbc-')).map(key => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url).catch(() => {}))))
  );
});
