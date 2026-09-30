import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { parseLine } from '../session/parse';
import { scanStore } from '../session/scanner';
import type { ScanFn } from '../session/scan-cache';
import { tailLines } from '../session/tailer';
import type { ApprovalBroker } from '../approval/broker';
import { DEFAULT_TOOL_WHITELIST, createCanUseTool } from '../approval/policy';
import type { SessionDriver, SendMessageInput } from './driver';

export interface SdkDriverOptions {
  broker?: ApprovalBroker;
  whitelist?: readonly string[];
  scan?: ScanFn;
  execPath?: string;
  exists?: (path: string) => boolean;
}

// Compiled single-package form (spec D5'): bun --compile bundles JS only, so
// the SDK's native CLI binary ships as a sibling file next to the exe and is
// passed explicitly. Dev form (node + tsx) resolves from the module tree as
// before — nothing sits beside node.exe.
export function besideExecutableClaude(
  execPath: string,
  exists: (path: string) => boolean,
): string | undefined {
  const beside = join(dirname(execPath), process.platform === 'win32' ? 'claude.exe' : 'claude');
  return exists(beside) ? beside : undefined;
}

interface SdkMessage {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  model?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
}

export function mapSdkMessages(messages: SdkMessage[]): DriverEvent[] {
  const events: DriverEvent[] = [];
  for (const message of messages) {
    if (message.type === 'assistant') {
      const text = (message.message?.content ?? [])
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('');
      if (text) events.push({ type: 'assistant', text });
    } else if (message.type === 'result') {
      events.push({
        type: 'result',
        subtype: message.subtype ?? 'unknown',
        text: message.result ?? '',
        sessionId: message.session_id ?? '',
      });
    } else if (message.type === 'system') {
      events.push({ type: 'system', subtype: message.subtype ?? 'system' });
    }
  }
  return events;
}

export class SdkDriver implements SessionDriver {
  private readonly whitelist: readonly string[];
  private readonly scan: ScanFn;
  private readonly claudeExecutable: string | undefined;
  private currentSessionId: string | null = null;

  private readonly canUseTool: ReturnType<typeof createCanUseTool>;

  constructor(
    private readonly claudeDir: string,
    private readonly options: SdkDriverOptions = {},
  ) {
    this.whitelist = options.whitelist ?? DEFAULT_TOOL_WHITELIST;
    this.scan = options.scan ?? scanStore;
    this.claudeExecutable = besideExecutableClaude(
      options.execPath ?? process.execPath,
      options.exists ?? existsSync,
    );
    this.canUseTool = createCanUseTool(this.whitelist, this.options.broker, () => this.currentSessionId);
  }

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return this.scan(this.claudeDir);
  }

  async *streamSession(
    sessionId: string,
    opts: { fromStart: boolean; signal: AbortSignal; fromByte?: number },
  ): AsyncGenerator<ParsedLine> {
    const file = await this.findSessionFile(sessionId);
    let lineNo = 0;
    for await (const raw of tailLines(file, {
      fromStart: opts.fromStart,
      fromByte: opts.fromByte,
      signal: opts.signal,
      pollMs: 1000,
    })) {
      lineNo += 1;
      yield parseLine(raw, lineNo);
    }
  }

  async *sendMessage(input: SendMessageInput): AsyncGenerator<DriverEvent> {
    this.currentSessionId = input.sessionId;
    for await (const message of query({
      prompt: input.text,
      options: {
        resume: input.sessionId ?? undefined,
        cwd: input.projectPath,
        canUseTool: this.canUseTool,
        pathToClaudeCodeExecutable: this.claudeExecutable,
      },
    })) {
      const msg = message as SdkMessage & { session_id?: string };
      if (msg.session_id) this.currentSessionId = msg.session_id;
      const [event] = mapSdkMessages([msg]);
      if (event) yield event;
    }
  }

  private async findSessionFile(sessionId: string): Promise<string> {
    const { sessions } = await this.list();
    const hit = sessions.find((session) => session.sessionId === sessionId);
    if (!hit) throw new Error(`session not found: ${sessionId}`);
    return hit.file;
  }
}
