import Fastify from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVaultRoutes } from './vault-routes';

let root: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-vaultapi-'));
  app = Fastify();
  registerVaultRoutes(app, root);
});

afterEach(async () => {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('vault routes', () => {
  it('lists the tree', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'x');
    const res = await app.inject({ method: 'GET', url: '/api/vault/tree' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ root, tree: [{ path: 'a.md', kind: 'file' }] });
  });

  it('reads, writes and creates notes', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'old');
    const read = await app.inject({ method: 'GET', url: '/api/vault/file?path=a.md' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ path: 'a.md', content: 'old' });

    const put = await app.inject({ method: 'PUT', url: '/api/vault/file', payload: { path: 'a.md', content: 'new' } });
    expect(put.statusCode).toBe(200);

    const post = await app.inject({ method: 'POST', url: '/api/vault/file', payload: { path: 'dir/b.md', content: '# b' } });
    expect(post.statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/api/vault/file', payload: { path: 'dir/b.md', content: '# b' } });
    expect(again.statusCode).toBe(409);
  });

  it('answers 400 for escapes and non-md paths, 404 for missing', async () => {
    const escape = await app.inject({ method: 'GET', url: '/api/vault/file?path=../x.md' });
    expect(escape.statusCode).toBe(400);
    expect(escape.json()).toEqual({ error: 'path_escape' });
    const txt = await app.inject({ method: 'PUT', url: '/api/vault/file', payload: { path: 'a.txt', content: 'x' } });
    expect(txt.statusCode).toBe(400);
    const missing = await app.inject({ method: 'GET', url: '/api/vault/file?path=nope.md' });
    expect(missing.statusCode).toBe(404);
  });

  it('searches and validates q', async () => {
    await fs.writeFile(path.join(root, 'a.md'), 'smart heating\n');
    const hit = await app.inject({ method: 'GET', url: '/api/vault/search?q=heating' });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toEqual({ matches: [{ path: 'a.md', line: 1, text: 'smart heating' }] });
    const blank = await app.inject({ method: 'GET', url: '/api/vault/search?q=' });
    expect(blank.statusCode).toBe(400);
  });

  it('logs note writes for the audit trail (spec 5.6)', async () => {
    await fs.writeFile(path.join(root, 'audit.md'), 'seed');
    const infoSpy = vi.spyOn(app.log, 'info');
    await app.inject({ method: 'PUT', url: '/api/vault/file', payload: { path: 'audit.md', content: 'x' } });
    await app.inject({ method: 'POST', url: '/api/vault/file', payload: { path: 'audit-new.md', content: 'x' } });
    const writeCall = infoSpy.mock.calls.find(([, msg]) => msg === 'vault note written');
    const createCall = infoSpy.mock.calls.find(([, msg]) => msg === 'vault note created');
    expect(writeCall?.[0]).toMatchObject({ path: 'audit.md' });
    expect(createCall?.[0]).toMatchObject({ path: 'audit-new.md' });
  });

  it('answers 503 when the vault is not configured', async () => {
    const unconfigured = Fastify();
    registerVaultRoutes(unconfigured, null);
    const res = await unconfigured.inject({ method: 'GET', url: '/api/vault/tree' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'vault_not_configured' });
    await unconfigured.close();
  });
});
