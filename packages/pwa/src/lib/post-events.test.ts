import { describe, expect, it } from 'vitest';
import { postEventError } from './post-events';

describe('postEventError', () => {
  it('extracts the message from error events', () => {
    expect(postEventError({ type: 'error', message: 'boom' })).toBe('boom');
  });

  it('ignores renderable events — the tailed JSONL stream owns bubble rendering', () => {
    expect(postEventError({ type: 'assistant', text: 'hi' })).toBeNull();
    expect(postEventError({ type: 'system', subtype: 'init' })).toBeNull();
    expect(postEventError({ type: 'result', subtype: 'success', text: 't', sessionId: 's' })).toBeNull();
  });
});
