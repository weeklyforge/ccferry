import type { FastifyInstance } from 'fastify';
import type { ApprovalBroker } from '../approval/broker';
import { startSse } from './sse';

const KEEPALIVE_MS = 15_000;

export function registerApprovalRoutes(app: FastifyInstance, broker: ApprovalBroker): void {
  app.get('/api/approvals', async () => ({ approvals: broker.listPending() }));

  app.get('/api/approvals/stream', async (req, reply) => {
    startSse(reply.raw);
    for (const request of broker.listPending()) {
      reply.raw.write(`data: ${JSON.stringify(request)}\n\n`);
    }
    const unsubscribe = broker.subscribe((request) => {
      reply.raw.write(`data: ${JSON.stringify(request)}\n\n`);
    });
    const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), KEEPALIVE_MS);
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(keepalive);
    });
  });

  app.post('/api/approvals/:id/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { decision?: string };
    if (body.decision !== 'allow' && body.decision !== 'deny') {
      return reply.code(400).send({ error: 'decision must be allow or deny' });
    }
    const outcome = broker.decide(id, body.decision);
    if (outcome === 'applied') return { ok: true };
    if (outcome === 'already') return reply.code(409).send({ error: 'already_decided' });
    return reply.code(404).send({ error: 'unknown approval' });
  });
}
