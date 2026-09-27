/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
self.skipWaiting();
clientsClaim();

// After a deploy the newly-activated SW controls pages that were rendered
// from the OLD precache; their lazy chunks may no longer resolve, leaving
// tabs dead (owner: tapping a tab froze the page). Reload each open client
// once so it comes back on the new bundle.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('navigate' in client) void client.navigate(client.url);
      }
    })(),
  );
});

interface PushPayload {
  title?: string;
  body?: string;
  sessionId?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data ? event.data.text() : undefined };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'ccferry', {
      body: payload.body,
      tag: payload.sessionId ?? 'ccferry',
      data: payload,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })(),
  );
});
