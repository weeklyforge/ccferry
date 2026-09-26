import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DaemonConfig {
  vaultPath?: string;
  toolWhitelist: string[];
  approvalTimeoutMs: number;
}

const DEFAULT_TOOL_WHITELIST = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];

export function loadConfig(filePath?: string): DaemonConfig {
  const file = filePath ?? path.join(os.homedir(), '.ccferry', 'config.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`ccferry: ignoring invalid config file ${file}:`, error);
    }
    raw = {};
  }
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    vaultPath: typeof source['vaultPath'] === 'string' ? source['vaultPath'] : undefined,
    toolWhitelist: Array.isArray(source['toolWhitelist'])
      ? source['toolWhitelist'].filter((entry): entry is string => typeof entry === 'string')
      : [...DEFAULT_TOOL_WHITELIST],
    approvalTimeoutMs:
      typeof source['approvalTimeoutMs'] === 'number' && source['approvalTimeoutMs'] > 0
        ? source['approvalTimeoutMs']
        : 60_000,
  };
}
