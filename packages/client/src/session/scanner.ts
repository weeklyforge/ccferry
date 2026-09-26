import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { extractFirstUserText, parseLine } from './parse';

const HEAD_CAP_BYTES = 64 * 1024;

export async function readHead(filePath: string, capBytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(capBytes);
    const { bytesRead } = await handle.read(buffer, 0, capBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function scanStore(claudeDir: string): Promise<{
  projects: ProjectSummary[];
  sessions: SessionSummary[];
}> {
  const projectsDir = path.join(claudeDir, 'projects');
  const sessions: SessionSummary[] = [];
  let dirEntries: Dirent[] = [];
  try {
    dirEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return { projects: [], sessions: [] };
  }
  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(projectsDir, entry.name);
    for (const fileName of await fs.readdir(dirPath)) {
      if (!fileName.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, fileName);
      const stat = await fs.stat(filePath);
      const head = await readHead(filePath, HEAD_CAP_BYTES);
      sessions.push({
        sessionId: fileName.slice(0, -'.jsonl'.length),
        projectPath: resolveProjectPath(head) ?? decodeMungedName(entry.name),
        file: filePath,
        sizeBytes: stat.size,
        lastModifiedMs: stat.mtimeMs,
        firstUserText: findFirstUserText(head) ?? '',
      });
    }
  }
  sessions.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const projects = buildProjects(sessions);
  return { projects, sessions };
}

function buildProjects(sessions: SessionSummary[]): ProjectSummary[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.projectPath, (counts.get(session.projectPath) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([projectPath, sessionCount]) => ({ projectPath, sessionCount }))
    .sort((a, b) => b.sessionCount - a.sessionCount);
}

function resolveProjectPath(head: string): string | null {
  for (const raw of head.split('\n')) {
    const parsed = parseLine(raw, 0);
    if (parsed.ok && typeof parsed.json['cwd'] === 'string') {
      return parsed.json['cwd'];
    }
  }
  return null;
}

function findFirstUserText(head: string): string | null {
  for (const raw of head.split('\n')) {
    const parsed = parseLine(raw, 0);
    if (!parsed.ok) continue;
    const text = extractFirstUserText(parsed.json);
    if (text) return text;
  }
  return null;
}

export function decodeMungedName(name: string): string {
  return name.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\');
}
