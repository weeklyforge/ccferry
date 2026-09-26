import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import type { SessionDriver, SendMessageInput } from './driver';

export class FakeDriver implements SessionDriver {
  constructor(
    private readonly projects: ProjectSummary[] = [],
    private readonly sessions: SessionSummary[] = [],
    private readonly lines: ParsedLine[] = [],
    private readonly events: DriverEvent[] = [],
  ) {}

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return { projects: this.projects, sessions: this.sessions };
  }

  async *streamSession(): AsyncGenerator<ParsedLine> {
    for (const line of this.lines) yield line;
  }

  async *sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent> {
    yield { type: 'system', subtype: 'init' };
    yield { type: 'assistant', text: `echo:${input.text}` };
    yield {
      type: 'result',
      subtype: 'success',
      text: `echo:${input.text}`,
      sessionId: input.sessionId ?? 'new-session',
    };
  }
}
