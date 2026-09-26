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
  | { ok: false; line: number; raw: string };

export type DriverEvent =
  | { type: 'assistant'; text: string }
  | { type: 'system'; subtype: string }
  | { type: 'result'; subtype: string; text: string; sessionId: string }
  | { type: 'error'; message: string };

export type ApprovalDecision = 'allow' | 'deny';

export interface ToolApprovalRequest {
  approvalId: string;
  sessionId: string | null;
  toolName: string;
  input: Record<string, unknown>;
  createdAtMs: number;
  timeoutMs: number;
}

// Broadcast when an approval is decided or times out, so every connected
// client can drop the card instead of showing a ghost until its own sweep.
export interface ApprovalSettledFrame {
  type: 'settled';
  approvalId: string;
  decision: ApprovalDecision | 'timeout';
}

export interface VaultNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  sizeBytes?: number;
  children?: VaultNode[];
}

export interface VaultSearchMatch {
  path: string;
  line: number;
  text: string;
}

export type StreamMessage =
  | { type: 'snapshot'; sessions: SessionSummary[] }
  | { type: 'append'; sessionId: string; lines: ParsedLine[] };


// Events flowing PC -> cloud over the event stream (spec section 1, D2'):
// the pipeline Web Push will later consume.
export type CloudEvent =
  | { kind: 'approval'; request: ToolApprovalRequest }
  | { kind: 'settled'; approvalId: string; decision: string }
  | { kind: 'tunnel'; state: 'connected' | 'disconnected' }
  | { kind: 'result'; sessionId: string; ok: boolean; excerpt: string; at: number };
