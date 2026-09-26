import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { scanStore } from './scanner';

export type ScanResult = { projects: ProjectSummary[]; sessions: SessionSummary[] };
export type ScanFn = (claudeDir: string) => Promise<ScanResult>;

export function cachedScan(claudeDir: string, ttlMs: number, scan: ScanFn = scanStore): ScanFn {
  let cached: { at: number; value: ScanResult } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const value = await scan(claudeDir);
    cached = { at: Date.now(), value };
    return value;
  };
}
