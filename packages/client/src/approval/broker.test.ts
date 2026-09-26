import { describe, expect, it } from 'vitest';
import { ApprovalBroker, truncateInput } from './broker';

describe('truncateInput (Review Focus 5)', () => {
  it('caps long string values at 1KB', () => {
    const input = { command: 'x'.repeat(5000) };
    const out = truncateInput(input);
    const value = out['command'] as string;
    expect(value.length).toBeLessThan(1200);
    expect(value).toContain('(+');
  });

  it('caps the whole payload at 16KB total', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) input[`k${i}`] = 'y'.repeat(900);
    const serialized = JSON.stringify(truncateInput(input));
    expect(serialized.length).toBeLessThanOrEqual(17_000);
    expect(JSON.parse(serialized)).toHaveProperty('_ccferryTruncated');
  });
});

describe('ApprovalBroker', () => {
  it('denies on timeout (fail-closed, Review Focus 2)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 40 });
    const outcome = await broker.requestApproval({ sessionId: 's1', toolName: 'Bash', input: {} });
    expect(outcome).toEqual({ behavior: 'deny', message: expect.stringContaining('timeout') });
    expect(broker.listPending()).toHaveLength(0);
  });

  it('resolves on decision and rejects a second decision', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    const pending = broker.requestApproval({ sessionId: 's1', toolName: 'Write', input: { p: 1 } });
    const [request] = broker.listPending();
    expect(request?.toolName).toBe('Write');
    expect(broker.decide(request!.approvalId, 'allow')).toBe('applied');
    expect(await pending).toEqual({ behavior: 'allow' });
    expect(broker.decide(request!.approvalId, 'deny')).toBe('already');
    expect(broker.decide('no-such-id', 'deny')).toBe('unknown');
  });

  it('notifies subscribers and reports subscriber count', () => {
    const broker = new ApprovalBroker();
    const seen: string[] = [];
    const unsubscribe = broker.subscribe((frame) => {
      if (!('type' in frame)) seen.push(frame.toolName);
    });
    expect(broker.subscriberCount()).toBe(1);
    void broker.requestApproval({ sessionId: null, toolName: 'Bash', input: {} });
    expect(seen).toEqual(['Bash']);
    unsubscribe();
    expect(broker.subscriberCount()).toBe(0);
  });

  it('broadcasts a settled frame on decision', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 5000 });
    const frames: unknown[] = [];
    broker.subscribe((frame) => frames.push(frame));
    const pending = broker.requestApproval({ sessionId: null, toolName: 'Bash', input: {} });
    const [request] = broker.listPending();
    await Promise.resolve();
    broker.decide(request!.approvalId, 'allow');
    await pending;
    const settled = frames.find((f) => (f as { type?: string }).type === 'settled') as
      | { approvalId: string; decision: string }
      | undefined;
    expect(settled).toMatchObject({ approvalId: request!.approvalId, decision: 'allow' });
  });

  it('broadcasts a settled frame with decision timeout on expiry', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 30 });
    const frames: unknown[] = [];
    broker.subscribe((frame) => frames.push(frame));
    await broker.requestApproval({ sessionId: null, toolName: 'Bash', input: {} });
    const settled = frames.find((f) => (f as { type?: string }).type === 'settled') as
      | { decision: string }
      | undefined;
    expect(settled?.decision).toBe('timeout');
  });

  it('bounds the settled-id memory (minor 6)', async () => {
    const broker = new ApprovalBroker({ timeoutMs: 60_000 });
    for (let i = 0; i < 1002; i++) {
      const pending = broker.requestApproval({ sessionId: null, toolName: 'T', input: {} });
      const [request] = broker.listPending();
      broker.decide(request!.approvalId, 'deny');
      await pending;
    }
    // The settled set must not grow past its cap.
    expect(broker.settledCount()).toBeLessThanOrEqual(1000);
  });
});
