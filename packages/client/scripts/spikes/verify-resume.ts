import { query } from '@anthropic-ai/claude-agent-sdk';

async function ask(prompt: string, resume?: string): Promise<{ text: string; sessionId: string }> {
  let text = '';
  let sessionId = '';
  for await (const message of query({ prompt, options: { resume } })) {
    const msg = message as { type?: string; subtype?: string; result?: string; session_id?: string };
    if (msg.type === 'result') {
      text = msg.result ?? '';
      sessionId = msg.session_id ?? '';
    }
  }
  return { text, sessionId };
}

async function main(): Promise<void> {
  const first = await ask('Remember the number 42. Reply with exactly: ACK');
  console.log('first reply:', first.text, '| session:', first.sessionId);
  if (!first.sessionId) throw new Error('no session id captured');

  const second = await ask('Which number did I ask you to remember? Reply with the number only.', first.sessionId);
  console.log('resumed reply:', second.text);
  console.log(second.text.includes('42') ? 'SPIKE-B: PASS' : 'SPIKE-B: FAIL');
}

main();
