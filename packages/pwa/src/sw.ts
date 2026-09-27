/// <reference lib="webworker" />

interface PushPayload {
  title?: string;
  body?: string;
  sessionId?: string;
}

// DOM lib and webworker lib both declare `self`; alias through the webworker
// shape explicitly so both libs can stay in the program.
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.skipWaiting();
sw.addEventListener('activate', (event) => {
  // Purge anything cached by an earlier (workbox-based) service worker.
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }
  event.waitUntil(
    sw.registration.showNotification(payload.title ?? 'ccferry', {
      body: payload.body,
      tag: payload.sessionId ?? 'ccferry',
      data: payload,
    }),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return sw.clients.openWindow('/');
    })(),
  );
});
