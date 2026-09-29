import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { FrameType } from '@ccferry/protocol/src/frame';
import { createPhoneAuthHook } from './auth';
import { EventBuffer } from './events/buffer';
import { registerFcmRoutes } from './api/fcm-routes';
import { registerPushRoutes } from './api/push-routes';
import { attachPushSender, sendTestPush } from './push/sender';
import { createFcmSender } from './push/fcm-sender';
import { FcmStore } from './push/fcm-store';
import { SubscriptionStore, type PushSubscription } from './push/store';
import { startSseLike } from './sse';
import { StreamRouter } from './tunnel/stream-router';
import { TunnelServer } from './tunnel/server';

const EVENT_STREAM_ID = 0x8000_0000;
const KEEPALIVE_MS = 15_000;

export interface CloudAppOptions {
  tunnelToken: string;
  phoneToken: string;
  pwaDir?: string | null;
  vapid?: { publicKey: string; privateKey: string; subject: string } | null;
  subscriptionsPath?: string | null;
  fcmSubscriptionsPath?: string | null;
}

export async function buildCloudApp(opts: CloudAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      redact: { paths: ['req.url', 'req.headers.authorization'], censor: '[redacted]' },
    },
  });
  await app.register(websocket);

  const tunnel = new TunnelServer({ tunnelToken: opts.tunnelToken });
  const router = new StreamRouter({ tunnel });
  const events = new EventBuffer();
  const sseClients = new Set<string>();
  const store = new SubscriptionStore(opts.subscriptionsPath ?? null);
  await store.load();
  const fcmStore = new FcmStore(opts.fcmSubscriptionsPath ?? null);
  await fcmStore.load();
  const fcmAccountPath = process.env['FCM_SERVICE_ACCOUNT'] ?? null;
  const native = fcmAccountPath
    ? {
        store: fcmStore,
        send: await createFcmSender(fcmAccountPath),
      }
    : undefined; // native push not configured — route 503s, web path unaffected
  const send = opts.vapid
    ? async (sub: PushSubscription, payload: string): Promise<void> => {
        const { sendNotification } = await import('web-push');
        await sendNotification(sub as unknown as import('web-push').PushSubscription, payload, {
          vapidDetails: { subject: opts.vapid!.subject, publicKey: opts.vapid!.publicKey, privateKey: opts.vapid!.privateKey },
        });
      }
    : async (): Promise<void> => undefined; // push not configured — routes 503, sender is a no-op
  attachPushSender(events, {
    store,
    send,
    isForeground: (clientId) => sseClients.has(clientId),
    native,
    log: (message) => app.log.info(`push: ${message}`),
  });
  registerPushRoutes(app, {
    store,
    publicKey: opts.vapid?.publicKey ?? null,
    sendTest: () => sendTestPush(events),
  });
  registerFcmRoutes(app, { store: fcmStore, ready: Boolean(native) });

  tunnel.attach(app); // registers GET /tunnel as the websocket route

  app.addHook('onRequest', createPhoneAuthHook(opts.phoneToken));

  app.get('/api/events/stream', async (req, reply) => {
    startSseLike(reply.raw);
    const clientId = (req.query as { clientId?: string }).clientId;
    if (clientId) sseClients.add(clientId);
    for (const event of events.snapshot()) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    const unsubscribe = events.subscribe((event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`));
    const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), KEEPALIVE_MS);
    req.raw.on('close', () => {
      if (clientId) sseClients.delete(clientId);
      unsubscribe();
      clearInterval(keepalive);
    });
  });

  router.register(app); // /api/* catch-all after the explicit route

  tunnel.onFrame((frame) => {
    if (frame.type === FrameType.Data && frame.streamId === EVENT_STREAM_ID) {
      try {
        events.push(JSON.parse(frame.payload.toString('utf8')) as Record<string, unknown>);
      } catch {
        // malformed event — drop
      }
    }
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultPwaDir = path.resolve(here, '../../pwa-dist');
  const pwaDir = opts.pwaDir ?? defaultPwaDir;
  if (pwaDir && existsSync(pwaDir)) {
    await app.register(fastifyStatic, { root: pwaDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
