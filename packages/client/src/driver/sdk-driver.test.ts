import { describe, expect, it } from 'vitest';
import { SdkDriver } from './sdk-driver';

describe('SdkDriver.sendMessage', () => {
  it('maps SDK messages into DriverEvents (assistant/system/result)', async () => {
    const driver = new SdkDriver('/nonexistent');
    const events = [];
    // The private generator is exercised through the public interface; stub
    // the query layer by testing the pure mapper instead.
    const sdkMessages = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] } },
      { type: 'result', subtype: 'success', result: 'done', session_id: 'sid-1' },
      { type: 'other' },
    ];
    for (const event of mapSdkMessages(sdkMessages)) events.push(event);
    expect(events).toEqual([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', text: 'hello world' },
      { type: 'result', subtype: 'success', text: 'done', sessionId: 'sid-1' },
    ]);
  });
});

import { mapSdkMessages } from './sdk-driver';
