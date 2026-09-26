import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

interface Snapshot {
  [file: string]: number;
}

async function snapshot(claudeDir: string): Promise<Snapshot> {
  const out: Snapshot = {};
  const projectsDir = path.join(claudeDir, 'projects');
  try {
    const dirs = await fs.readdir(projectsDir);
    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir);
      for (const file of await fs.readdir(dirPath)) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        out[filePath] = stat.size;
      }
    }
  } catch {
    // store not created yet
  }
  return out;
}

async function ask(prompt: string, cwd: string, resume?: string): Promise<string> {
  let sessionId = '';
  for await (const message of query({
    prompt,
    options: { cwd, resume },
  })) {
    const msg = message as { type?: string; subtype?: string; session_id?: string };
    if (msg.type === 'result') sessionId = msg.session_id ?? '';
  }
  return sessionId;
}

async function main(): Promise<void> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-fork-'));
  const claudeDir = path.join(os.homedir(), '.claude');

  const before = await snapshot(claudeDir);
  const sid1 = await ask('Reply with exactly: ONE', scratch);
  const sid2 = await ask('Reply with exactly: TWO', scratch, sid1);
  const after = await snapshot(claudeDir);

  console.log('sid1:', sid1);
  console.log('sid2:', sid2);
  console.log('same id:', sid1 === sid2);
  for (const [file, size] of Object.entries(after)) {
    const delta = size - (before[file] ?? 0);
    if (delta !== 0 || !(file in before)) {
      console.log(delta > 0 ? 'GREW' : 'NEW  ', file, `(+${size - (before[file] ?? 0)} bytes)`);
    }
  }
}

main();
