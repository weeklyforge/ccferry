import { Buffer } from 'node:buffer';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FrameType, OPEN_KIND, encodeOpen, type Frame } from '@ccferry/protocol/src/frame';
import type { TunnelServer } from './server';

interface PendingStream {
  req: FastifyRequest;
  reply: FastifyReply;
  headersSent: boolean;
  timer: NodeJS.Timeout;
}

export class StreamRouter {
  private readonly pending = new Map<number, PendingStream>();
  private nextStreamId = 1;
  private readonly timeoutMs: number;
  private readonly optsRef: { tunnel: TunnelServer };

  constructor(opts: { tunnel: TunnelServer; requestTimeoutMs?: number }) {
    this.optsRef = opts;
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  register(app: FastifyInstance): void {
    app.all('/api/*', async (req, reply) => this.handle(req, reply));
    this.optsRef.tunnel.onFrame((frame) => this.onTunnelFrame(frame));
  }

  private async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const tunnel = this.optsRef.tunnel;
    if (tunnel.connectedPeerCount() === 0) {
      return reply.code(502).send({ error: 'tunnel_down' });
    }
    const streamId = this.allocateId();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
    let body = Buffer.alloc(0);
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body));
      headers['content-type'] = headers['content-type'] ?? 'application/json';
    }
    const timer = setTimeout(() => this.fail(streamId), this.timeoutMs);
    this.pending.set(streamId, { req, reply, headersSent: false, timer });
    // bodyBytes tells the PC when the request body is complete so it can
    // issue the upstream fetch (no separate end-of-request frame in v0).
    const open = encodeOpen(streamId, OPEN_KIND.http, {
      method: req.method,
      path: req.url,
      headers,
      bodyBytes: body.length,
    });
    tunnel.send(open.readUInt8(0), open.readUInt32BE(1), open.subarray(7));
    if (body.length > 0) {
      for (let offset = 0; offset < body.length; offset += 65_535) {
        tunnel.send(FrameType.Data, streamId, body.subarray(offset, offset + 65_535));
      }
    }
    await new Promise<void>(() => undefined); // response completes via onTunnelFrame
  }

  private allocateId(): number {
    const id = this.nextStreamId;
    this.nextStreamId = (this.nextStreamId + 1) % 0x7fff_ffff || 1;
    return id;
  }

  private fail(streamId: number): void {
    const stream = this.pending.get(streamId);
    if (!stream) return;
    this.pending.delete(streamId);
    if (!stream.headersSent) {
      stream.reply.raw.writeHead(502, { 'content-type': 'application/json' });
      stream.reply.raw.end(JSON.stringify({ error: 'tunnel_timeout' }));
    } else {
      stream.reply.raw.destroy();
    }
  }

  private onTunnelFrame(frame: Frame): void {
    if (frame.type !== FrameType.Data && frame.type !== FrameType.Close) return;
    const stream = this.pending.get(frame.streamId);
    if (!stream) return;
    if (frame.type === FrameType.Data) {
      if (!stream.headersSent) {
        stream.headersSent = true;
        const header = JSON.parse(frame.payload.toString('utf8')) as { status: number; headers: Record<string, string> };
        stream.reply.raw.writeHead(header.status, header.headers);
        return;
      }
      stream.reply.raw.write(frame.payload); // SSE: each DATA frame flushes
      return;
    }
    clearTimeout(stream.timer);
    this.pending.delete(frame.streamId);
    const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 0;
    if (code !== 0 && !stream.headersSent) {
      stream.reply.raw.writeHead(502, { 'content-type': 'application/json' });
      stream.reply.raw.end(JSON.stringify({ error: 'tunnel_stream_error' }));
    } else {
      stream.reply.raw.end();
    }
  }
}
