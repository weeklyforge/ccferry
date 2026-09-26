import type { FastifyInstance } from 'fastify';
import type { PushSubscription, SubscriptionStore } from '../push/store';

export interface PushRoutesOptions {
  store: SubscriptionStore;
  publicKey: string | null;
  sendTest: () => Promise<void>;
}

export function registerPushRoutes(app: FastifyInstance, opts: PushRoutesOptions): void {
  app.get('/api/push/key', async (_req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    return { publicKey: opts.publicKey };
  });

  app.post('/api/push/subscribe', async (req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    const body = (req.body ?? {}) as { clientId?: string; endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (
      typeof body.clientId !== 'string' || !body.clientId ||
      typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://') ||
      typeof body.keys?.p256dh !== 'string' || !body.keys.p256dh ||
      typeof body.keys.auth !== 'string' || !body.keys.auth
    ) {
      return reply.code(400).send({ error: 'invalid_subscription' });
    }
    const sub: PushSubscription = {
      clientId: body.clientId,
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      createdAt: Date.now(),
    };
    await opts.store.add(sub);
    return reply.code(204).send();
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const body = (req.body ?? {}) as { endpoint?: string };
    if (typeof body.endpoint !== 'string' || !body.endpoint) return reply.code(400).send({ error: 'endpoint required' });
    await opts.store.remove(body.endpoint);
    return reply.code(204).send();
  });

  app.post('/api/push/test', async (_req, reply) => {
    if (!opts.publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    await opts.sendTest();
    return reply.code(204).send();
  });
}
