import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPhoneAuthHook } from './auth';

describe('phone auth hook', () => {
  it('rejects /api without a valid token and accepts Bearer or ?token=', async () => {
    const app = Fastify();
    app.addHook('onRequest', createPhoneAuthHook('phone-secret'));
    app.get('/api/events/stream', async () => ({ ok: true }));
    const denied = await app.inject({ method: 'GET', url: '/api/events/stream' });
    expect(denied.statusCode).toBe(401);
    const bearer = await app.inject({ method: 'GET', url: '/api/events/stream', headers: { authorization: 'Bearer phone-secret' } });
    expect(bearer.statusCode).toBe(200);
    const query = await app.inject({ method: 'GET', url: '/api/events/stream?token=phone-secret' });
    expect(query.statusCode).toBe(200);
  });

  it('leaves non-/api paths open (PWA shell)', async () => {
    const app = Fastify();
    app.addHook('onRequest', createPhoneAuthHook('phone-secret'));
    app.get('/', async () => 'shell');
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
  });

  it('does not treat /apifoo as an api route', async () => {
    const app = Fastify();
    app.addHook('onRequest', createPhoneAuthHook('phone-secret'));
    app.get('/apifoo', async () => 'not-api');
    const res = await app.inject({ method: 'GET', url: '/apifoo' });
    expect(res.statusCode).toBe(200); // no 401 — the prefix check is exact
  });
});
