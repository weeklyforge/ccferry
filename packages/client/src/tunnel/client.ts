import { Buffer } from 'node:buffer';
import WebSocket from 'ws';
import {
  FrameType,
  OPEN_KIND,
  decodeFrames,
  decodeOpenMeta,
  encodeFrame,
  encodeOpen,
  type Frame,
} from '@ccferry/protocol/src/frame';
import type { ApprovalBroker } from '../approval/broker';
import { nextDelayMs } from './backoff';

const EVENT_STREAM_ID = 0x8000_0000;
const CHUNK = 65_535;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']);

export interface TunnelClientOptions {
  url: string;
  token: string;
  targetBase?: string;
  bearer?: string;
  broker?: ApprovalBroker;
  log?: (message: string) => void;
}

export class TunnelClient {
  private socket: WebSocket | null = null;
  private activeSocket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private readonly aborts = new Map<number, AbortController>();
  private readonly log: (message: string) => void;

  constructor(private readonly opts: TunnelClientOptions) {
    this.log = opts.log ?? (() => undefined);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.socket) this.eventSendBestEffort({ kind: 'tunnel', state: 'disconnected' });
    this.unsubscribeBroker?.();
    this.unsubscribeBroker = null;
    this.socket?.close();
    this.socket = null;
    for (const controller of this.aborts.values()) controller.abort();
    this.aborts.clear();
  }

  isConnected(): boolean {
    return this.socket !== null;
  }

  waitForConnected(timeoutMs = 5000): Promise<void> {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.socket) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('tunnel connect timeout'));
        }
      }, 20);
    });
  }

  eventSend(payload: Record<string, unknown>): void {
    this.send(FrameType.Data, EVENT_STREAM_ID, Buffer.from(JSON.stringify(payload), 'utf8'));
  }

  private eventSendBestEffort(payload: Record<string, unknown>): void {
    try {
      this.eventSend(payload);
    } catch {
      // send-after-close race — nothing to deliver anyway
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(this.opts.url);
    this.activeSocket = socket;
    let rest: Buffer = Buffer.alloc(0);
    socket.on('open', () => {
      socket.send(encodeFrame(FrameType.Auth, 0, Buffer.from(this.opts.token, 'utf8')));
    });
    socket.on('message', (data) => {
      rest = Buffer.concat([rest, Buffer.from(data as Buffer)]);
      const { frames, rest: remaining } = decodeFrames(rest);
      rest = remaining;
      for (const frame of frames) this.onFrame(frame);
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.eventSendBestEffort({ kind: 'tunnel', state: 'disconnected' });
        this.socket = null;
      }
      this.aborts.forEach((controller) => controller.abort()); // Review Focus 2
      this.aborts.clear();
      this.log('tunnel closed, reconnecting');
      if (this.stopped) return;
      const delay = nextDelayMs(this.attempt);
      this.attempt += 1;
      setTimeout(() => this.connect(), delay);
    });
    socket.on('error', (error) => this.log(`tunnel error: ${String(error)}`));
    // this.socket is only set AFTER AuthOk: isConnected/waitForConnected must
    // mean "authenticated", matching the cloud's connectedPeerCount().
  }

  private send(type: number, streamId: number, payload: Buffer): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeFrame(type, streamId, payload));
    }
  }

  private unsubscribeBroker: (() => void) | null = null;

  private startEventBridge(): void {
    this.unsubscribeBroker?.(); // reconnect path: drop the previous subscription
    const broker = this.opts.broker;
    // Snapshot first: a reattached phone must see pending approvals again.
    if (broker) {
      for (const request of broker.listPending()) {
        this.eventSend({ kind: 'approval', request });
      }
      this.unsubscribeBroker = broker.subscribe((frame) => {
        if ('toolName' in frame) {
          this.eventSend({ kind: 'approval', request: frame });
        } else {
          this.eventSend({ kind: 'settled', approvalId: frame.approvalId, decision: frame.decision });
        }
      });
    }
    this.eventSend({ kind: 'tunnel', state: 'connected' });
  }

  private onFrame(frame: Frame): void {
    if (frame.type === FrameType.AuthOk) {
      this.attempt = 0;
      this.socket = this.activeSocket;
      const open = encodeOpen(EVENT_STREAM_ID, OPEN_KIND.event, {});
      this.send(FrameType.Open, EVENT_STREAM_ID, open.subarray(7));
      this.startEventBridge();
      this.log('tunnel authenticated');
      return;
    }
    if (frame.type === FrameType.Open) {
      const { kind, meta } = decodeOpenMeta(frame.payload);
      if (kind === OPEN_KIND.http) void this.bridgeHttp(frame.streamId, meta);
      return;
    }
  }

  private async bridgeHttp(streamId: number, meta: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    this.aborts.set(streamId, controller);
    const headers: Record<string, string> = {};
    const rawHeaders = (meta['headers'] ?? {}) as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
    }
    if (this.opts.bearer) headers['authorization'] = `Bearer ${this.opts.bearer}`;
    const base = this.opts.targetBase ?? 'http://127.0.0.1:8787';
    try {
      const response = await fetch(`${base}${meta['path'] ?? '/'}`, {
        method: (meta['method'] ?? 'GET') as string,
        headers,
        signal: controller.signal,
      });
      const headerPayload = JSON.stringify({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      });
      this.send(FrameType.Data, streamId, Buffer.from(headerPayload, 'utf8'));
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = Buffer.from(value);
          while (chunk.length > 0) {
            const piece = chunk.subarray(0, CHUNK);
            this.send(FrameType.Data, streamId, piece);
            chunk = chunk.subarray(CHUNK);
          }
        }
      }
      this.send(FrameType.Close, streamId, Buffer.from([0, 0]));
    } catch {
      this.send(FrameType.Close, streamId, Buffer.from([0, 1]));
    } finally {
      this.aborts.delete(streamId);
    }
  }
}
