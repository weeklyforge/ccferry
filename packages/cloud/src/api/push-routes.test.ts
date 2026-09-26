import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SubscriptionStore } from '../push/store';
import { registerPushRoutes } from './push-routes';

function buildApp(publicKey: string | null) {
  const app = Fastify();
  const store = new SubscriptionStore(null);
  registerPushRoutes(app, { store, publicKey, sendTest: async () => undefined });
  return { app, store };
}

describe('push routes', () => {
  it('returns the vapid public key', async () => {
    const { app } = buildApp('PUBKEY');
    const res = await app.inject({ method: 'GET', url: '/api/push/key' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicKey: 'PUBKEY' });
  });

  it('503s when push is not configured', async () => {
    const { app } = buildApp(null);
    expect((await app.inject({ method: 'GET', url: '/api/push/key' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/push/test' })).statusCode).toBe(503);
  });

  it('accepts a valid subscription and rejects bad payloads', async () => {
    const { app, store } = buildApp('PUB');
    const ok = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(ok.statusCode).toBe(204);
    expect(store.list()).toHaveLength(1);
    const insecure = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'http://insecure/', keys: { p256dh: 'k', auth: 'a' } },
    });
    expect(insecure.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { clientId: 'c1', endpoint: 'https://x/', keys: { p256dh: 'k' } },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('unsubscribes by endpoint', async () => {
    const { app, store } = buildApp('PUB');
    await store.add({ clientId: 'c', endpoint: 'https://e', keys: { p256dh: 'k', auth: 'a' }, createdAt: 0 });
    const res = await app.inject({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: 'https://e' } });
    expect(res.statusCode).toBe(204);
    expect(store.list()).toHaveLength(0);
  });
});
