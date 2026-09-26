import type { FastifyInstance, FastifyReply } from 'fastify';
import { createJsSearchEngine } from '../vault/search';
import { createNote, readNote, writeNote } from '../vault/files';
import { readTree } from '../vault/tree';

const engine = createJsSearchEngine();

export function registerVaultRoutes(app: FastifyInstance, vaultRoot: string | null): void {
  app.get('/api/vault/tree', async (_req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    return { root, tree: await readTree(root) };
  });

  app.get('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: 'path required' });
    const outcome = await readNote(root, relPath);
    if (outcome.status !== 'ok') {
      return outcome.status === 'escape'
        ? reply.code(400).send({ error: 'path_escape' })
        : reply.code(404).send({ error: 'note not found' });
    }
    return { path: relPath, content: outcome.content };
  });

  app.put('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const body = (req.body ?? {}) as { path?: string; content?: string };
    if (!body.path || typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'path and content required' });
    }
    if (!body.path.toLowerCase().endsWith('.md')) return reply.code(400).send({ error: 'only .md notes' });
    const outcome = await writeNote(root, body.path, body.content);
    if (outcome === 'escape') return reply.code(400).send({ error: 'path_escape' });
    if (outcome === 'missing') return reply.code(404).send({ error: 'note not found' });
    req.log.info({ path: body.path }, 'vault note written');
    return { ok: true };
  });

  app.post('/api/vault/file', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const body = (req.body ?? {}) as { path?: string; content?: string };
    if (!body.path) return reply.code(400).send({ error: 'path required' });
    if (!body.path.toLowerCase().endsWith('.md')) return reply.code(400).send({ error: 'only .md notes' });
    const outcome = await createNote(root, body.path, body.content ?? '');
    if (outcome === 'escape') return reply.code(400).send({ error: 'path_escape' });
    if (outcome === 'exists') return reply.code(409).send({ error: 'note exists' });
    req.log.info({ path: body.path }, 'vault note created');
    return reply.code(201).send({ ok: true });
  });

  app.get('/api/vault/search', async (req, reply) => {
    const root = requireRoot(vaultRoot, reply);
    if (!root) return;
    const { q } = req.query as { q?: string };
    if (!q || !q.trim()) return reply.code(400).send({ error: 'q required' });
    return { matches: await engine.search(root, q) };
  });
}

function requireRoot(vaultRoot: string | null, reply: FastifyReply): string | null {
  if (!vaultRoot) {
    void reply.code(503).send({ error: 'vault_not_configured' });
    return null;
  }
  return vaultRoot;
}
