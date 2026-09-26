import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function createPhoneAuthHook(token: string): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req, reply) => {
    if (!req.url.startsWith('/api')) return; // static PWA shell stays open
    const header = req.headers['authorization'];
    const query = req.query as Record<string, unknown>;
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const provided =
      tokenMatches(token, bearer) ||
      tokenMatches(token, typeof query['token'] === 'string' ? query['token'] : undefined);
    if (!provided) return reply.code(401).send({ error: 'unauthorized' });
  };
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}
