import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import { startSse } from './sse';

// Opens a brand-new session (sessionId null) in the given project. This is
// the vault "agent organize" entry point: the PWA posts here with
// projectPath = vault root, and the session then shows up in the overview
// like any other (spec section 3.6).
export function registerNewSessionRoute(app: FastifyInstance, driver: SessionDriver): void {
  app.post('/api/messages', async (req, reply) => {
    const body = (req.body ?? {}) as { projectPath?: string; text?: string };
    if (!body.projectPath || !body.text) {
      return reply.code(400).send({ error: 'projectPath and text required' });
    }
    startSse(reply.raw);
    try {
      for await (const event of driver.sendMessage({
        sessionId: null,
        projectPath: body.projectPath,
        text: body.text,
      })) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      req.log.error({ err: error }, 'new session failed');
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage(error) })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
