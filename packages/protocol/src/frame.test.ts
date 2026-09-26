import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  FrameType,
  OPEN_KIND,
  decodeFrames,
  decodeOpenMeta,
  encodeFrame,
  encodeOpen,
} from './frame';

describe('frame codec', () => {
  it('round-trips every frame type', () => {
    for (const type of [FrameType.Auth, FrameType.AuthOk, FrameType.Open, FrameType.Data, FrameType.Close, FrameType.Ping, FrameType.Pong]) {
      const frame = encodeFrame(type, 42, Buffer.from('hello'));
      const { frames, rest } = decodeFrames(frame);
      expect(rest.length).toBe(0);
      expect(frames).toHaveLength(1);
      expect(frames[0]!.type).toBe(type);
      expect(frames[0]!.streamId).toBe(42);
      expect(frames[0]!.payload.toString()).toBe('hello');
    }
  });

  it('reassembles frames split across buffers (Review Focus 5)', () => {
    const first = encodeFrame(FrameType.Data, 7, Buffer.from('part-payload'));
    const split = first.subarray(0, 4);
    let parsed = decodeFrames(split);
    expect(parsed.frames).toHaveLength(0);
    parsed = decodeFrames(Buffer.concat([parsed.rest, first.subarray(4)]));
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]!.payload.toString()).toBe('part-payload');
    expect(parsed.rest.length).toBe(0);
  });

  it('parses multiple frames in one buffer and keeps an incomplete tail', () => {
    const a = encodeFrame(FrameType.Ping, 0, Buffer.alloc(0));
    const b = encodeFrame(FrameType.Data, 9, Buffer.from('xyz'));
    const c = encodeFrame(FrameType.Close, 9, Buffer.from([0, 0]));
    const cut = c.subarray(0, 5);
    const { frames, rest } = decodeFrames(Buffer.concat([a, b, cut]));
    expect(frames.map((f) => f.type)).toEqual([FrameType.Ping, FrameType.Data]);
    expect(rest.equals(cut)).toBe(true);
  });

  it('round-trips OPEN meta', () => {
    const frame = encodeOpen(3, OPEN_KIND.http, { method: 'GET', path: '/api/projects', headers: { accept: '*/*' } });
    const { frames } = decodeFrames(frame);
    const { kind, meta } = decodeOpenMeta(frames[0]!.payload);
    expect(kind).toBe(OPEN_KIND.http);
    expect(meta['path']).toBe('/api/projects');
  });
});
