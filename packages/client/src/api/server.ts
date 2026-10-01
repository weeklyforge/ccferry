import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import type { ApprovalBroker } from '../approval/broker';
import { registerApprovalRoutes } from './approval-routes';
import { searchSessions } from './history-search';
import { registerNewSessionRoute } from './new-session-route';
import { registerVaultRoutes } from './vault-routes';
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
  vaultRoot?: string | null;
  token?: string;
  // Cap on waiting for the next driver event during a send. A stalled
  // resume (huge session, wedged CLI) used to hold the POST's SSE open
  // forever: the phone's sender stayed "sending" and every later tap was
  // silently swallowed. On idle, the stream gets an explicit error frame
  // and ends, so clients surface the failure and reset.
  sendMessageTimeoutMs?: number;
}

const SEND_IDLE = Symbol('send-idle');

async function nextEventOrIdle<T>(
  iterator: AsyncIterator<T>,
  idleMs: number,
): Promise<IteratorResult<T> | typeof SEND_IDLE> {
  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<typeof SEND_IDLE>((resolve) => {
    timer = setTimeout(() => resolve(SEND_IDLE), idleMs);
  });
  try {
    return await Promise.race([iterator.next(), idle]);
  } finally {
    clearTimeout(timer);
  }
}

export function buildServer(driver: SessionDriver, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.addHook('onRequest', async (req, reply) => {
    if (opts.token) {
      // Token mode (LAN): the token is the gate; Bearer header or ?token= (SSE).
      if (!req.url.startsWith('/api/')) return; // static PWA shell stays open
      const header = req.headers['authorization'];
      const query = req.query as Record<string, unknown>;
      const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      const provided =
        tokenMatches(opts.token, bearer) || tokenMatches(opts.token, typeof query['token'] === 'string' ? query['token'] : undefined);
      if (!provided) return reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    // Tokenless mode (localhost): keep the M1 DNS-rebinding Host allowlist.
    const hostname = req.hostname.replace(/^\[|\]$/g, '');
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return reply.code(403).send({ error: 'host not allowed' });
    }
  });

  app.get('/api/projects', async () => driver.list().then((r) => ({ projects: r.projects })));

  app.get('/api/sessions', async () => (await driver.list()).sessions);

  app.get('/api/history/search', async (req, reply) => {
    const query = req.query as { q?: string; project?: string; days?: string; limit?: string };
    if (!query.q?.trim()) return reply.code(400).send({ error: 'q required' });
    const { sessions } = await driver.list();
    return searchSessions(sessions, query.q, {
      project: query.project,
      days: query.days ? Number(query.days) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  });

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sessions } = await driver.list();
    if (!sessions.some((session) => session.sessionId === id)) {
      return reply.code(404).send({ error: 'session not found' });
    }
    const query = req.query as { fromStart?: string; tailBytes?: string };
    const target = sessions.find((s) => s.sessionId === id);
    startSse(reply.raw);
    const controller = new AbortController();
    req.raw.on('close', () => controller.abort());
    // tailBytes caps how much history the client pulls (phone-friendly);
    // the driver skips any partial first line at the chosen offset.
    let fromByte: number | undefined;
    if (query.fromStart === 'true' && query.tailBytes && Number(query.tailBytes) > 0 && target) {
      fromByte = Math.max(0, target.sizeBytes - Number(query.tailBytes));
    }
    try {
      for await (const line of driver.streamSession(id, {
        fromStart: query.fromStart === 'true',
        fromByte,
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
    const idleMs = opts.sendMessageTimeoutMs ?? 90_000;
    const events = driver.sendMessage({
      sessionId: id,
      projectPath: session.projectPath,
      text: body.text,
    });
    try {
      for (;;) {
        const next = await nextEventOrIdle(events, idleMs);
        if (next === SEND_IDLE) {
          req.log.error({ sessionId: id }, 'send message stalled with no driver events');
          events.return(undefined).catch(() => undefined); // cancel the stalled query
          reply.raw.write(
            `data: ${JSON.stringify({ type: 'error', message: 'send timed out: the session produced no response' })}\n\n`,
          );
          break;
        }
        if (next.done) break;
        reply.raw.write(`data: ${JSON.stringify(next.value)}\n\n`);
      }
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'send message failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage(error) })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  if (opts.broker) registerApprovalRoutes(app, opts.broker);
  registerVaultRoutes(app, opts.vaultRoot ?? null);
  registerNewSessionRoute(app, driver, opts.vaultRoot ?? null);

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Constant-time token comparison: hash both sides to a fixed length so
// timingSafeEqual never leaks length or early-mismatch information.
function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}
