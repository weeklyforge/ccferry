import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import type { ApprovalBroker } from '../approval/broker';
import { registerApprovalRoutes } from './approval-routes';
import { startSse } from './sse';

const ACTIVE_WINDOW_MS = 120_000;

// The daemon binds to 127.0.0.1; also demand a loopback Host header so a
// visited website cannot reach it through DNS rebinding (which would make
// the request same-origin and skip the browser's CSRF preflight).
// With a token configured (Task 9) the token becomes the gate instead.
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

export interface ServerOptions {
  logger?: boolean;
  broker?: ApprovalBroker;
}

export function buildServer(driver: SessionDriver, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.addHook('onRequest', async (req, reply) => {
    const hostname = req.hostname.replace(/^\[|\]$/g, '');
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'host not allowed' });
    }
  });

  app.get('/api/projects', async () => driver.list().then((r) => ({ projects: r.projects })));

  app.get('/api/sessions', async () => (await driver.list()).sessions);

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sessions } = await driver.list();
    if (!sessions.some((session) => session.sessionId === id)) {
      return reply.code(404).send({ error: 'session not found' });
    }
    const query = req.query as { fromStart?: string };
    startSse(reply.raw);
    const controller = new AbortController();
    req.raw.on('close', () => controller.abort());
    try {
      for await (const line of driver.streamSession(id, {
        fromStart: query.fromStart === 'true',
        signal: controller.signal,
      })) {
        reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'session stream failed');
      reply.raw.write(`: ccferry error: ${errorMessage(error)}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { text?: string; force?: boolean };
    if (!body.text) return reply.code(400).send({ error: 'text required' });
    const { sessions } = await driver.list();
    const session = sessions.find((s) => s.sessionId === id);
    if (!session) return reply.code(404).send({ error: 'session not found' });
    if (Date.now() - session.lastModifiedMs < ACTIVE_WINDOW_MS && !body.force) {
      return reply.code(409).send({ error: 'session_active', lastModifiedMs: session.lastModifiedMs });
    }
    startSse(reply.raw);
    try {
      for await (const event of driver.sendMessage({
        sessionId: id,
        projectPath: session.projectPath,
        text: body.text,
      })) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'send message failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage(error) })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  if (opts.broker) registerApprovalRoutes(app, opts.broker);

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
