import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FcmStore, type FcmSubscription } from './fcm-store';

const sub = (token: string, overrides: Partial<FcmSubscription> = {}): FcmSubscription => ({
  clientId: 'c1',
  platform: 'ios',
  token,
  createdAt: 0,
  ...overrides,
});

const dirs: string[] = [];
afterAll(async () => {
  // temp dirs areOS-cleaned; no explicit rm needed
  void dirs;
});

describe('FcmStore', () => {
  it('adds, lists, and removes subscriptions in memory', async () => {
    const store = new FcmStore(null);
    await store.add(sub('tok1'));
    await store.add(sub('tok2', { platform: 'android' }));
    expect(store.list()).toHaveLength(2);
    await store.remove('tok1');
    expect(store.list().map((s) => s.token)).toEqual(['tok2']);
  });

  it('upserts by token', async () => {
    const store = new FcmStore(null);
    await store.add(sub('tok1', { clientId: 'old' }));
    await store.add(sub('tok1', { clientId: 'new', platform: 'android' }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.clientId).toBe('new');
    expect(store.list()[0]!.platform).toBe('android');
  });

  it('persists to disk and reloads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fcm-'));
    dirs.push(dir);
    const file = path.join(dir, 'fcm.json');
    const store = new FcmStore(file);
    await store.load();
    await store.add(sub('tok1', { createdAt: 42 }));
    const raw = JSON.parse(await readFile(file, 'utf8')) as FcmSubscription[];
    expect(raw).toHaveLength(1);
    expect(raw[0]!.token).toBe('tok1');

    const reloaded = new FcmStore(file);
    await reloaded.load();
    expect(reloaded.list().map((s) => s.createdAt)).toEqual([42]);
  });

  it('starts empty on a corrupt file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fcm-'));
    dirs.push(dir);
    const file = path.join(dir, 'fcm.json');
    await writeFile(file, 'not json{');
    const store = new FcmStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
  });
});
