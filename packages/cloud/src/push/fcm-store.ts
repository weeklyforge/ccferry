import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface FcmSubscription {
  clientId: string;
  platform: 'ios' | 'android';
  token: string;
  createdAt: number;
}

// Disk-backed (when filePath is set) FCM token store; same atomic
// tmp+rename persist pattern as the web-push SubscriptionStore so a crash
// cannot truncate it. Deliberately a SEPARATE file from
// push-subscriptions.json — the web-push path stays byte-identical.
export class FcmStore {
  private readonly subs = new Map<string, FcmSubscription>();

  constructor(private readonly filePath: string | null) {}

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as FcmSubscription[];
      for (const sub of parsed) this.subs.set(sub.token, sub);
    } catch {
      this.subs.clear(); // missing or corrupt — start empty
    }
  }

  async add(sub: FcmSubscription): Promise<void> {
    this.subs.set(sub.token, sub);
    await this.persist();
  }

  async remove(token: string): Promise<void> {
    if (!this.subs.delete(token)) return;
    await this.persist();
  }

  list(): FcmSubscription[] {
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
