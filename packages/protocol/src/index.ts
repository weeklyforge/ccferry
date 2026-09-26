export interface ProjectSummary {
  projectPath: string;
  sessionCount: number;
}

export interface SessionSummary {
  sessionId: string;
  projectPath: string;
  file: string;
  sizeBytes: number;
  lastModifiedMs: number;
  firstUserText: string;
}

export type ParsedLine =
  | { ok: true; line: number; json: Record<string, unknown> }
  | { ok: false; line: number };

export type DriverEvent =
  | { type: 'assistant'; text: string }
  | { type: 'system'; subtype: string }
  | { type: 'result'; subtype: string; text: string; sessionId: string };

export type StreamMessage =
  | { type: 'snapshot'; sessions: SessionSummary[] }
  | { type: 'append'; sessionId: string; lines: ParsedLine[] };
