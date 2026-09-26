import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url including - and _ characters', () => {
    // standard atob fails on - and _; this must not throw.
    // 'AQ--_w' normalizes to 'AQ++/w==' → bytes 0x01 0x0F 0xBE.
    const bytes = urlBase64ToUint8Array('AQ--_w');
    expect(Array.from(bytes)).toEqual([1, 15, 190, 255]);
  });

  it('round-trips a VAPID-shaped 65-byte key', () => {
    // 87 base64url chars + 1 pad = 65 raw bytes, the P-256 key shape;
    // 'BA' prefixes byte 0 as 0x04 (uncompressed EC point marker).
    const key = 'B' + 'A'.repeat(85) + '-';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
