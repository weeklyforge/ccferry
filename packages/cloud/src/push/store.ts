import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PushSubscription {
  clientId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

// Disk-backed (when filePath is set) subscription store; the file write is
// atomic (tmp + rename) so a crash cannot truncate it.
export class SubscriptionStore {
  private readonly subs = new Map<string, PushSubscription>();

  constructor(private readonly filePath: string | null) {}

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PushSubscription[];
      for (const sub of parsed) this.subs.set(sub.endpoint, sub);
    } catch {
      this.subs.clear(); // missing or corrupt — start empty
    }
  }

  async add(sub: PushSubscription): Promise<void> {
    this.subs.set(sub.endpoint, sub);
    await this.persist();
  }

  async remove(endpoint: string): Promise<void> {
    if (!this.subs.delete(endpoint)) return;
    await this.persist();
  }

  list(): PushSubscription[] {
    return [...this.subs.values()];
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const tmp = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(this.list()));
    await fs.rename(tmp, this.filePath);
  }
}
