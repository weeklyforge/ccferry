import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { SdkDriver } from './driver/sdk-driver';
import { ApprovalBroker } from './approval/broker';
import { loadConfig } from './config';
import { cachedScan } from './session/scan-cache';
import { computeBindHost } from './api/bind';
import { buildServer } from './api/server';

const config = loadConfig();
const port = Number(process.env['CCFERRY_PORT'] ?? 8787);
const token = process.env['CCFERRY_TOKEN'] || undefined;
const host = computeBindHost(token, process.env['CCFERRY_HOST']);
const claudeDir = path.join(os.homedir(), '.claude');
const broker = new ApprovalBroker({ timeoutMs: config.approvalTimeoutMs });

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPwaDir = path.resolve(here, '../../pwa/dist');
const pwaDir = process.env['CCFERRY_PWA_DIR'] ?? defaultPwaDir;

const app = buildServer(
  new SdkDriver(claudeDir, {
    broker,
    whitelist: config.toolWhitelist,
    scan: cachedScan(claudeDir, 5000),
  }),
  { broker, vaultRoot: config.vaultPath ?? null, token, logger: true },
);

if (existsSync(pwaDir)) {
  await app.register(fastifyStatic, { root: pwaDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  console.warn(`ccferry: PWA directory not found at ${pwaDir} — serving API only`);
}

app
  .listen({ port, host })
  .then(() => console.log(`ccferry daemon listening on http://${host}:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
