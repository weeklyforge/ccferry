import { query } from '@anthropic-ai/claude-agent-sdk';

async function main(): Promise<void> {
  for await (const message of query({ prompt: 'Reply with exactly: OK-GLM' })) {
    const msg = message as { type?: string; subtype?: string; model?: string; result?: string };
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('init model:', msg.model);
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      console.log('result:', msg.result);
    }
  }
}

main();
