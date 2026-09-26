import { describe, expect, it } from 'vitest';
import { highlightSegments } from './highlight';

describe('highlightSegments', () => {
  it('splits text around case-insensitive query matches', () => {
    expect(highlightSegments('Smart Heating plan', 'heating')).toEqual([
      { text: 'Smart ', hit: false },
      { text: 'Heating', hit: true },
      { text: ' plan', hit: false },
    ]);
  });

  it('marks every occurrence', () => {
    expect(highlightSegments('aXAxa', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: 'X', hit: false },
      { text: 'A', hit: true },
      { text: 'x', hit: false },
      { text: 'a', hit: true },
    ]);
  });

  it('returns one plain segment when the query does not match', () => {
    expect(highlightSegments('nothing here', 'zzz')).toEqual([{ text: 'nothing here', hit: false }]);
  });

  it('returns one plain segment for an empty query', () => {
    expect(highlightSegments('anything', '  ')).toEqual([{ text: 'anything', hit: false }]);
  });
});
