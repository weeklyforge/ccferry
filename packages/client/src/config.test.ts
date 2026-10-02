import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';

let tmp: string;
let configFile: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-cfg-'));
  configFile = path.join(tmp, 'config.json');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults when the file is missing', () => {
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBeUndefined();
    expect(config.toolWhitelist).toEqual(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite']);
    expect(config.approvalTimeoutMs).toBe(60000);
  });

  it('loads values from the file', async () => {
    await fs.writeFile(configFile, JSON.stringify({
      vaultPath: 'D:/some/vault',
      toolWhitelist: ['Read'],
      approvalTimeoutMs: 30000,
    }));
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBe('D:/some/vault');
    expect(config.toolWhitelist).toEqual(['Read']);
    expect(config.approvalTimeoutMs).toBe(30000);
  });

  it('falls back to defaults on invalid JSON', async () => {
    await fs.writeFile(configFile, '{ not json');
    const config = loadConfig(configFile);
    expect(config.toolWhitelist).toEqual(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite']);
    expect(config.approvalTimeoutMs).toBe(60000);
  });

  it('merges partial files with defaults', async () => {
    await fs.writeFile(configFile, JSON.stringify({ vaultPath: 'D:/v' }));
    const config = loadConfig(configFile);
    expect(config.vaultPath).toBe('D:/v');
    expect(config.approvalTimeoutMs).toBe(60000);
  });

  it('loads activeSessionWindowMs, including 0 to disable the guard', async () => {
    await fs.writeFile(configFile, JSON.stringify({ activeSessionWindowMs: 0 }));
    expect(loadConfig(configFile).activeSessionWindowMs).toBe(0);

    await fs.writeFile(configFile, JSON.stringify({ activeSessionWindowMs: 300000 }));
    expect(loadConfig(configFile).activeSessionWindowMs).toBe(300000);

    await fs.writeFile(configFile, JSON.stringify({}));
    expect(loadConfig(configFile).activeSessionWindowMs).toBeUndefined();
  });
});
