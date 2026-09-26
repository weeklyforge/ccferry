import { query } from '@anthropic-ai/claude-agent-sdk';
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { parseLine } from '../session/parse';
import { scanStore } from '../session/scanner';
import type { ScanFn } from '../session/scan-cache';
import { tailLines } from '../session/tailer';
import type { ApprovalBroker, PermissionResult } from '../approval/broker';
import { DEFAULT_TOOL_WHITELIST, evaluateToolPolicy } from '../approval/policy';
import type { SessionDriver, SendMessageInput } from './driver';

export interface SdkDriverOptions {
  broker?: ApprovalBroker;
  whitelist?: readonly string[];
  scan?: ScanFn;
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
  private currentSessionId: string | null = null;

  constructor(
    private readonly claudeDir: string,
    private readonly options: SdkDriverOptions = {},
  ) {
    this.whitelist = options.whitelist ?? DEFAULT_TOOL_WHITELIST;
    this.scan = options.scan ?? scanStore;
  }

  private readonly canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    if (evaluateToolPolicy(toolName, this.whitelist) === 'allow') {
      return { behavior: 'allow' };
    }
    if (!this.options.broker) {
      // No broker configured (unit contexts): stay fail-closed like M1.
      return { behavior: 'deny', message: 'Tool use requires remote approval; no approval broker is configured.' };
    }
    return this.options.broker.requestApproval({
      sessionId: this.currentSessionId,
      toolName,
      input,
    });
  };

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return this.scan(this.claudeDir);
  }

  async *streamSession(
    sessionId: string,
    opts: { fromStart: boolean; signal: AbortSignal },
  ): AsyncGenerator<ParsedLine> {
    const file = await this.findSessionFile(sessionId);
    let lineNo = 0;
    for await (const raw of tailLines(file, {
      fromStart: opts.fromStart,
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
