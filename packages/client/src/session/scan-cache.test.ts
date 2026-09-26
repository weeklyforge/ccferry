import { describe, expect, it } from 'vitest';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { cachedScan } from './scan-cache';

const result: { projects: ProjectSummary[]; sessions: SessionSummary[] } = { projects: [], sessions: [] };

function makeCountingScan(): { scan: () => Promise<typeof result>; calls: () => number } {
  let calls = 0;
  return {
    async scan() {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

describe('cachedScan', () => {
  it('serves repeated calls from cache within the TTL', async () => {
    const counter = makeCountingScan();
    const scan = cachedScan('/fake', 1000, counter.scan as never);
    await scan('/fake');
    await scan('/fake');
    await scan('/fake');
    expect(counter.calls()).toBe(1);
  });

  it('re-invokes after the TTL expires', async () => {
    const counter = makeCountingScan();
    const scan = cachedScan('/fake', 20, counter.scan as never);
    await scan('/fake');
    await new Promise((resolve) => setTimeout(resolve, 30));
    await scan('/fake');
    expect(counter.calls()).toBe(2);
  });
});
