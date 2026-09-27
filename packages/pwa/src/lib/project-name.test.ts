import { describe, expect, it } from 'vitest';
import { shortProject } from './project-name';

describe('shortProject', () => {
  it('returns the last segment of a windows path', () => {
    expect(shortProject('D:\\work\\proj A')).toBe('proj A');
  });

  it('handles posix separators and trailing slashes', () => {
    expect(shortProject('/home/user/ccferry/')).toBe('ccferry');
    expect(shortProject('D:/a/b')).toBe('b');
  });

  it('returns the input when there is no separator', () => {
    expect(shortProject('proj')).toBe('proj');
  });
});
