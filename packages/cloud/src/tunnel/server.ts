import { createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { FrameType, decodeFrames, encodeFrame, type Frame } from '@ccferry/protocol/src/frame';

const AUTH_FAIL_LIMIT = 5;
const AUTH_FAIL_WINDOW_MS = 60_000;
const BAN_MS = 10 * 60_000;

interface Peer {
  socket: WebSocket;
  authenticated: boolean;
  lastPongAt: number;
}

export class TunnelServer {
  private peer: Peer | null = null;
  private readonly frameHandlers = new Set<(frame: Frame) => void>();
  private readonly failures = new Map<string, { count: number; windowStart: number }>();
  private readonly bans = new Map<string, number>();

  constructor(
    private readonly opts: {
      tunnelToken: string;
      pingIntervalMs?: number;
      pongTimeoutMs?: number;
    },
  ) {}

  attach(app: FastifyInstance): void {
    const pingMs = this.opts.pingIntervalMs ?? 30_000;
    const pongTimeoutMs = this.opts.pongTimeoutMs ?? 60_000;
    app.get('/tunnel', { websocket: true }, (socket, request) => {
      const ip = request.socket.remoteAddress ?? 'unknown';
      if (this.bans.get(ip) && Date.now() < this.bans.get(ip)!) {
        socket.close(4403, 'banned');
        return;
      }
      const peer: Peer = { socket, authenticated: false, lastPongAt: Date.now() };
      let rest: Buffer = Buffer.alloc(0);
      const pingTimer = setInterval(() => {
        if (!peer.authenticated) return;
        if (Date.now() - peer.lastPongAt > pongTimeoutMs) {
          socket.terminate();
          this.dropPeer(peer);
          return;
        }
        try {
          this.send(FrameType.Ping, 0, Buffer.alloc(0));
        } catch {
          // send-after-close race — the close handler cleans up
        }
      }, pingMs);
      socket.on('close', () => {
        clearInterval(pingTimer);
        this.dropPeer(peer);
      });
      socket.on('message', (data) => {
        rest = Buffer.concat([rest, Buffer.from(data as Buffer)]);
        const { frames, rest: remaining } = decodeFrames(rest);
        rest = remaining;
        for (const frame of frames) this.handleFrame(peer, frame, ip);
      });
    });
  }

  send(type: number, streamId: number, payload: Buffer): boolean {
    if (!this.peer?.authenticated) return false;
    this.peer.socket.send(encodeFrame(type, streamId, payload));
    return true;
  }

  onFrame(cb: (frame: Frame) => void): void {
    this.frameHandlers.add(cb);
  }

  connectedPeerCount(): number {
    return this.peer?.authenticated ? 1 : 0;
  }

  private handleFrame(peer: Peer, frame: Frame, ip: string): void {
    if (frame.type === FrameType.Ping) {
      peer.socket.send(encodeFrame(FrameType.Pong, 0, Buffer.alloc(0)));
      return;
    }
    if (frame.type === FrameType.Pong) {
      peer.lastPongAt = Date.now();
      return;
    }
    if (!peer.authenticated) {
      if (frame.type !== FrameType.Auth) {
        peer.socket.close(4401, 'authenticate first');
        return;
      }
      if (!this.tokenMatches(frame.payload.toString('utf8'))) {
        this.recordFailure(ip);
        peer.socket.close(4401, 'bad token');
        return;
      }
      // Second authenticated connection kicks the first (spec section 4).
      if (this.peer && this.peer !== peer) this.peer.socket.close(4400, 'replaced');
      peer.authenticated = true;
      this.peer = peer;
      peer.socket.send(encodeFrame(FrameType.AuthOk, 0, Buffer.alloc(0)));
      return;
    }
    // Any authenticated inbound frame proves the peer is alive — defends a
    // busy link where a PONG can be lost while DATA keeps flowing.
    peer.lastPongAt = Date.now();
    for (const handler of this.frameHandlers) handler(frame);
  }

  private dropPeer(peer: Peer): void {
    if (this.peer === peer) this.peer = null;
  }

  private recordFailure(ip: string): void {
    const now = Date.now();
    const entry = this.failures.get(ip);
    if (!entry || now - entry.windowStart > AUTH_FAIL_WINDOW_MS) {
      this.failures.set(ip, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
    if (entry.count >= AUTH_FAIL_LIMIT) {
      this.bans.set(ip, now + BAN_MS);
      this.failures.delete(ip);
    }
  }

  private tokenMatches(provided: string): boolean {
    const a = createHash('sha256').update(this.opts.tunnelToken).digest();
    const b = createHash('sha256').update(provided).digest();
    return timingSafeEqual(a, b);
  }
}
