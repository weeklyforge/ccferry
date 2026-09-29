import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { FcmStore } from '../push/fcm-store';
import { registerFcmRoutes } from './fcm-routes';

function buildApp(ready: boolean) {
  const app = Fastify();
  const store = new FcmStore(null);
  registerFcmRoutes(app, { store, ready });
  return { app, store };
}

describe('fcm routes', () => {
  it('503s when fcm is not configured', async () => {
    const { app } = buildApp(false);
    const res = await app.inject({ method: 'POST', url: '/api/push/native/subscribe', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'push_not_configured' });
  });

  it('accepts a valid subscription', async () => {
    const { app, store } = buildApp(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/native/subscribe',
      payload: { clientId: 'c1', platform: 'ios', fcmToken: 'abcdefghijk' },
    });
    expect(res.statusCode).toBe(204);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.platform).toBe('ios');
  });

  it('rejects bad payloads', async () => {
    const { app, store } = buildApp(true);
    const missingClient = await app.inject({
      method: 'POST',
      url: '/api/push/native/subscribe',
      payload: { platform: 'ios', fcmToken: 'abcdefghijk' },
    });
    expect(missingClient.statusCode).toBe(400);
    const badPlatform = await app.inject({
      method: 'POST',
      url: '/api/push/native/subscribe',
      payload: { clientId: 'c', platform: 'web', fcmToken: 'abcdefghijk' },
    });
    expect(badPlatform.statusCode).toBe(400);
    const shortToken = await app.inject({
      method: 'POST',
      url: '/api/push/native/subscribe',
      payload: { clientId: 'c', platform: 'ios', fcmToken: 'short' },
    });
    expect(shortToken.statusCode).toBe(400);
    expect(store.list()).toHaveLength(0);
  });

  it('upserts when the same token re-subscribes', async () => {
    const { app, store } = buildApp(true);
    const payload = { clientId: 'c1', platform: 'ios', fcmToken: 'abcdefghijk' };
    await app.inject({ method: 'POST', url: '/api/push/native/subscribe', payload });
    await app.inject({
      method: 'POST',
      url: '/api/push/native/subscribe',
      payload: { ...payload, clientId: 'c2', platform: 'android' },
    });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.clientId).toBe('c2');
    expect(store.list()[0]!.platform).toBe('android');
  });
});
