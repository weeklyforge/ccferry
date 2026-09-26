import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';

export interface SendMessageInput {
  sessionId: string | null;
  projectPath: string;
  text: string;
}

export interface SessionDriver {
  list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }>;
  streamSession(sessionId: string, opts: { fromStart: boolean; signal: AbortSignal; fromByte?: number }): AsyncGenerator<ParsedLine>;
  sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent>;
}
