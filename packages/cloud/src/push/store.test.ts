import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionStore } from './store';

let file: string;

beforeEach(async () => {
  file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ccferry-subs-')), 'subs.json');
});
afterEach(async () => {
  await fs.rm(path.dirname(file), { recursive: true, force: true });
});

function sub(endpoint: string): Parameters<SubscriptionStore['add']>[0] {
  return { clientId: 'c1', endpoint, keys: { p256dh: 'k', auth: 'a' }, createdAt: Date.now() };
}

describe('SubscriptionStore', () => {
  it('adds, lists, and removes subscriptions', async () => {
    const store = new SubscriptionStore(null);
    await store.add(sub('https://e1'));
    await store.add(sub('https://e2'));
    expect(store.list()).toHaveLength(2);
    await store.remove('https://e1');
    expect(store.list().map((s) => s.endpoint)).toEqual(['https://e2']);
  });

  it('survives a restart via the file', async () => {
    const first = new SubscriptionStore(file);
    await first.load();
    await first.add(sub('https://keep'));
    const second = new SubscriptionStore(file);
    await second.load();
    expect(second.list().map((s) => s.endpoint)).toEqual(['https://keep']);
  });

  it('re-adding an endpoint updates instead of duplicating', async () => {
    const store = new SubscriptionStore(null);
    await store.add(sub('https://e1'));
    await store.add({ ...sub('https://e1'), clientId: 'c2' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.clientId).toBe('c2');
  });

  it('starts empty when the file is missing or corrupt', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json{');
    const store = new SubscriptionStore(file);
    await store.load();
    expect(store.list()).toEqual([]);
  });
});
