import { query } from '@anthropic-ai/claude-agent-sdk';
import type { DriverEvent, ParsedLine, ProjectSummary, SessionSummary } from '@ccferry/protocol';
import { parseLine } from '../session/parse';
import { scanStore } from '../session/scanner';
import { tailLines } from '../session/tailer';
import type { SessionDriver, SendMessageInput } from './driver';

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

async function denyAllTools(): Promise<{ behavior: 'deny'; message: string }> {
  // M1 safety default: the daemon never lets the model act unattended.
  // M2 replaces this with remote approval routing.
  return { behavior: 'deny', message: 'Tool use requires remote approval, which arrives in milestone M2.' };
}

export class SdkDriver implements SessionDriver {
  constructor(private readonly claudeDir: string) {}

  async list(): Promise<{ projects: ProjectSummary[]; sessions: SessionSummary[] }> {
    return scanStore(this.claudeDir);
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
    for await (const message of query({
      prompt: input.text,
      options: {
        resume: input.sessionId ?? undefined,
        cwd: input.projectPath,
        canUseTool: denyAllTools,
      },
    })) {
      const [event] = mapSdkMessages([message as SdkMessage]);
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
