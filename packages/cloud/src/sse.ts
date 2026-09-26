import type { ServerResponse } from 'node:http';

export function startSseLike(raw: ServerResponse): void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  raw.write(': ccferry events stream open\n\n');
}
