import type { FastifyInstance } from 'fastify';
import type { SessionDriver } from '../driver/driver';
import { startSse } from './sse';

// Opens a brand-new session (sessionId null) in the given project. The PWA
// posts here with projectPath from its project list (or the vault root for
// the "agent organize" entry), and the session then shows up in the overview
// like any other (spec section 3.6).
export function registerNewSessionRoute(app: FastifyInstance, driver: SessionDriver, vaultRoot: string | null): void {
  app.post('/api/messages', async (req, reply) => {
    const body = (req.body ?? {}) as { projectPath?: string; text?: string };
    if (!body.projectPath || !body.text) {
      return reply.code(400).send({ error: 'projectPath and text required' });
    }
    // Boundary (spec D1/D10): only projects already present in the session
    // store, plus the configured vault root itself.
    const { projects } = await driver.list();
    const known = projects.some((p) => p.projectPath === body.projectPath) || body.projectPath === vaultRoot;
    if (!known) return reply.code(403).send({ error: 'unknown_project' });
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
