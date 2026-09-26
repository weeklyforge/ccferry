import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { SessionDriver } from '../driver/driver';

const ACTIVE_WINDOW_MS = 120_000;

export function buildServer(driver: SessionDriver): FastifyInstance {
  const app = Fastify();

  app.get('/api/projects', async () => driver.list().then((r) => ({ projects: r.projects })));

  app.get('/api/sessions', async () => (await driver.list()).sessions);

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
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
    } finally {
      reply.raw.end();
    }
  });

  return app;
}

function startSse(raw: ServerResponse): void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}
