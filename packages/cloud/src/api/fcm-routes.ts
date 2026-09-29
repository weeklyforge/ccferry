import type { FastifyInstance } from 'fastify';
import type { FcmStore } from '../push/fcm-store';

export interface FcmRoutesOptions {
  store: FcmStore;
  ready: boolean; // false until FCM_SERVICE_ACCOUNT is configured
}

export function registerFcmRoutes(app: FastifyInstance, opts: FcmRoutesOptions): void {
  app.post('/api/push/native/subscribe', async (req, reply) => {
    if (!opts.ready) return reply.code(503).send({ error: 'push_not_configured' });
    const body = (req.body ?? {}) as { clientId?: string; platform?: string; fcmToken?: string };
    if (
      typeof body.clientId !== 'string' || !body.clientId ||
      (body.platform !== 'ios' && body.platform !== 'android') ||
      typeof body.fcmToken !== 'string' || body.fcmToken.length < 10
    ) {
      return reply.code(400).send({ error: 'invalid_subscription' });
    }
    await opts.store.add({
      clientId: body.clientId,
      platform: body.platform,
      token: body.fcmToken,
      createdAt: Date.now(),
    });
    return reply.code(204).send();
  });
}
