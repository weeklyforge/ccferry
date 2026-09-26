import { Buffer } from 'node:buffer';

// Wire format: [type:1B][streamId:4B][length:2B][payload:length]
export const FRAME_HEADER_SIZE = 7;
export const MAX_PAYLOAD = 65_535;

export const FrameType = {
  Auth: 1,
  AuthOk: 2,
  Open: 3,
  Data: 4,
  Close: 5,
  Ping: 6,
  Pong: 7,
} as const;

export const OPEN_KIND = { http: 0, event: 1 } as const;

export interface Frame {
  type: number;
  streamId: number;
  payload: Buffer;
}

export function encodeFrame(type: number, streamId: number, payload: Buffer): Buffer {
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} exceeds ${MAX_PAYLOAD}`);
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(streamId, 1);
  header.writeUInt16BE(payload.length, 5);
  return Buffer.concat([header, payload]);
}

// Incremental parser: returns complete frames plus the unconsumed tail so
// callers can prepend it to the next chunk (TCP/ws delivery may split frames).
export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  while (buffer.length - offset >= FRAME_HEADER_SIZE) {
    const type = buffer.readUInt8(offset);
    const streamId = buffer.readUInt32BE(offset + 1);
    const length = buffer.readUInt16BE(offset + 5);
    const end = offset + FRAME_HEADER_SIZE + length;
    if (buffer.length < end) break;
    frames.push({ type, streamId, payload: buffer.subarray(offset + FRAME_HEADER_SIZE, end) });
    offset = end;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export function encodeOpen(streamId: number, kind: number, meta: Record<string, unknown>): Buffer {
  const metaJson = Buffer.from(JSON.stringify(meta), 'utf8');
  const payload = Buffer.concat([Buffer.from([kind]), metaJson]);
  return encodeFrame(FrameType.Open, streamId, payload);
}

export function decodeOpenMeta(payload: Buffer): { kind: number; meta: Record<string, unknown> } {
  if (payload.length < 1) throw new Error('empty OPEN payload');
  const kind = payload.readUInt8(0);
  const meta = JSON.parse(payload.subarray(1).toString('utf8')) as Record<string, unknown>;
  return { kind, meta };
}
