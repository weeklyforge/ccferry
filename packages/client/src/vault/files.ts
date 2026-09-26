import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveInsideReal } from './sandbox';

export type ReadNoteResult = { status: 'ok'; content: string } | { status: 'escape' | 'missing' };

export async function readNote(root: string, relPath: string): Promise<ReadNoteResult> {
  const abs = await resolveInsideReal(root, relPath);
  if (!abs) return { status: 'escape' };
  try {
    return { status: 'ok', content: await fs.readFile(abs, 'utf8') };
  } catch {
    return { status: 'missing' };
  }
}

export async function writeNote(root: string, relPath: string, content: string): Promise<'escape' | 'missing' | 'ok'> {
  const abs = await resolveInsideReal(root, relPath);
  if (!abs) return 'escape';
  try {
    await fs.access(abs);
  } catch {
    return 'missing';
  }
  await fs.writeFile(abs, content, 'utf8');
  return 'ok';
}

export async function createNote(root: string, relPath: string, content: string): Promise<'escape' | 'exists' | 'created'> {
  const abs = await resolveInsideReal(root, relPath);
  if (!abs) return 'escape';
  try {
    await fs.access(abs);
    return 'exists';
  } catch {
    // not found — create it (with parent directories, Obsidian-style)
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return 'created';
}
