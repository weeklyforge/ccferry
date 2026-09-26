import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { PushSource, type ResultEvent } from './push-source';

let dir: string;
const events: Array<ResultEvent> = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-push-'));
  events.length = 0;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function session(id: string, sizeBytes: number): SessionSummary {
  return {
    sessionId: id,
    projectPath: 'D:\\work\\proj',
    file: path.join(dir, `${id}.jsonl`),
    sizeBytes,
    lastModifiedMs: Date.now(),
    firstUserText: 'hello',
  };
}

// Like the real scanner, reports live file sizes on every call.
function scanOf(sessions: SessionSummary[]): (claudeDir: string) => Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
  return async () => ({
    projects: [],
    sessions: await Promise.all(
      sessions.map(async (s) => ({ ...s, sizeBytes: (await fs.stat(s.file)).size })),
    ),
  });
}

async function append(file: string, text: string): Promise<void> {
  await fs.appendFile(file, text);
}

describe('PushSource', () => {
  it('seeds without emitting and emits one result event for new growth', async () => {
    const id = 's1';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, '{"type":"user","message":"hi"}\n{"type":"result","subtype":"success","result":"done","session_id":"s1"}\n');
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 0)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(events).toHaveLength(0); // seed poll: old results are old news

    await append(file, '{"type":"result","subtype":"success","result":"all finished","session_id":"s1"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'result', sessionId: 's1', ok: true, excerpt: 'all finished' });
  });

  it('marks non-success subtypes as errors', async () => {
    const id = 's2';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, '{"type":"user","message":"go"}\n');
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 0)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    await append(file, '{"type":"result","subtype":"error_during_execution","result":"boom","session_id":"s2"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events[0]).toMatchObject({ kind: 'result', ok: false, excerpt: 'boom' });
  });

  it('emits a result line split across polling windows exactly once', async () => {
    const id = 's3';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, '{"type":"user","message":"x"}\n');
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 0)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    await append(file, '{"type":"resu'); // partial line lands before a poll
    await new Promise((r) => setTimeout(r, 80));
    expect(events).toHaveLength(0); // incomplete line — not yet
    await append(file, 'lt","subtype":"success","result":"split done","session_id":"s3"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(1); // completed on a later poll, emitted once
    expect(events[0]).toMatchObject({ kind: 'result', ok: true, excerpt: 'split done' });
  });

  it('reseeds silently when the file shrinks (rotation)', async () => {
    const id = 's4';
    const file = path.join(dir, `${id}.jsonl`);
    await fs.writeFile(file, 'x'.repeat(100));
    const source = new PushSource({ claudeDir: dir, scan: scanOf([session(id, 0)]), pollMs: 20, onEvent: (e) => events.push(e) });
    source.start();
    await new Promise((r) => setTimeout(r, 60));
    await fs.writeFile(file, '{"type":"result","subtype":"success","result":"new file","session_id":"s4"}\n');
    await new Promise((r) => setTimeout(r, 120));
    source.stop();
    expect(events).toHaveLength(0); // shrunk file = rotation: reseed, no emit
  });
});
