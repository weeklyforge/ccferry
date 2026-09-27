import { describe, expect, it } from 'vitest';
import { waitForNewSession } from './new-task-start';

interface Row {
  sessionId: string;
  projectPath: string;
  lastModifiedMs: number;
}

function lister(rows: Row[], delayMs = 5): () => Promise<Row[]> {
  return async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return rows;
  };
}

describe('waitForNewSession', () => {
  const T0 = 1_000_000;

  it('returns the new session once the scanner lists it', async () => {
    const rows: Row[] = [];
    const list = (): Promise<Row[]> => {
      if (rows.length === 0) {
        setTimeout(() => rows.push({ sessionId: 'new-1', projectPath: 'D:\\p', lastModifiedMs: T0 + 5 }), 40);
      }
      return Promise.resolve([...rows]);
    };
    const id = await waitForNewSession(list, 'D:\\p', T0, { pollMs: 10, timeoutMs: 500 });
    expect(id).toBe('new-1');
  });

  it('ignores other projects and older sessions', async () => {
    const rows: Row[] = [
      { sessionId: 'old', projectPath: 'D:\\p', lastModifiedMs: T0 - 5000 },
      { sessionId: 'other', projectPath: 'D:\\q', lastModifiedMs: T0 + 100 },
    ];
    const id = await waitForNewSession(lister(rows, 1), 'D:\\p', T0, { pollMs: 10, timeoutMs: 80 });
    expect(id).toBeNull();
  });

  it('returns null on timeout', async () => {
    const id = await waitForNewSession(lister([], 1), 'D:\\p', T0, { pollMs: 10, timeoutMs: 60 });
    expect(id).toBeNull();
  });

  it('survives a failing list call', async () => {
    let calls = 0;
    const list = (): Promise<Row[]> => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('tunnel blip'));
      return Promise.resolve([{ sessionId: 'late', projectPath: 'D:\\p', lastModifiedMs: T0 + 1 }]);
    };
    const id = await waitForNewSession(list, 'D:\\p', T0, { pollMs: 10, timeoutMs: 500 });
    expect(id).toBe('late');
  });
});
