import { describe, expect, it } from 'vitest';
import { toFcmData } from './fcm-sender';

describe('toFcmData', () => {
  it('stringifies every value — fcm data rejects non-strings', () => {
    const data = toFcmData({ title: '任务完成', body: 'x', sessionId: 's1', force: true, count: 2 });
    expect(data).toEqual({
      title: '任务完成',
      body: 'x',
      sessionId: 's1',
      force: 'true',
      count: '2',
    });
    expect(Object.values(data).every((v) => typeof v === 'string')).toBe(true);
  });

  it('drops undefined optionals', () => {
    const data = toFcmData({ title: 't', body: 'b', sessionId: undefined, force: undefined });
    expect(data).toEqual({ title: 't', body: 'b' });
  });
});
