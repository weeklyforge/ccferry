import os from 'node:os';
import path from 'node:path';
import { SdkDriver } from './driver/sdk-driver';
import { ApprovalBroker } from './approval/broker';
import { loadConfig } from './config';
import { cachedScan } from './session/scan-cache';
import { buildServer } from './api/server';

const config = loadConfig();
const port = Number(process.env['CCFERRY_PORT'] ?? 8787);
const claudeDir = path.join(os.homedir(), '.claude');
const broker = new ApprovalBroker({ timeoutMs: config.approvalTimeoutMs });

const app = buildServer(
  new SdkDriver(claudeDir, {
    broker,
    whitelist: config.toolWhitelist,
    scan: cachedScan(claudeDir, 5000),
  }),
  { broker, logger: true },
);
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`ccferry daemon listening on http://127.0.0.1:${port}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
