import type { ServerResponse } from 'node:http';

// Idle heartbeat for long-lived SSE responses: the cloud tunnel's stream
// router severs any forwarded /api stream after 30s of silence, which used
// to drop the phone's session tail mid-turn and force a tail-window replay
// that can skip lines written during the gap. SSE comment frames carry no
// data payload, so every consumer ignores them — the keepalive is invisible
// to clients while feeding the tunnel's idle timer. The interval
// self-cleans once the response has ended.
const HEARTBEAT_MS = 15_000;

export function startSse(raw: ServerResponse): void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const timer = setInterval(() => {
    if (raw.writableEnded || raw.destroyed) {
      clearInterval(timer);
      return;
    }
    raw.write(': ka\n\n');
  }, HEARTBEAT_MS);
  timer.unref();
}
