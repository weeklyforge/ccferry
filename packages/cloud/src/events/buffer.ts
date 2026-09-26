const CAPACITY = 64;

export class EventBuffer {
  private readonly events: Record<string, unknown>[] = [];
  private readonly subscribers = new Set<(event: Record<string, unknown>) => void>();

  push(event: Record<string, unknown>): void {
    this.events.push(event);
    if (this.events.length > CAPACITY) this.events.splice(0, this.events.length - CAPACITY);
    for (const subscriber of this.subscribers) subscriber(event);
  }

  snapshot(): Record<string, unknown>[] {
    return [...this.events];
  }

  subscribe(writer: (event: Record<string, unknown>) => void): () => void {
    this.subscribers.add(writer);
    return () => this.subscribers.delete(writer);
  }
}
