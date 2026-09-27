<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Field, showConfirmDialog } from 'vant';
import type { ApprovalSettledFrame, ParsedLine, ToolApprovalRequest } from '@ccferry/protocol';
import { ApiError, readSsePost, sseUrl } from '../lib/api';
import { highlightKeywordsInElement, queryTerms } from '../lib/highlight';
import { renderMarkdown } from '../lib/markdown';
import { followSse } from '../lib/sse-follow';
import { useApprovalsStore } from '../stores/approvals';
import { parsedLineToBubble } from '../lib/bubbles';
import { postEventError } from '../lib/post-events';
import ApprovalCard from '../components/ApprovalCard.vue';

const route = useRoute();
const sessionId = route.params['id'] as string;
const approvals = useApprovalsStore();
const bubbles = ref<ReturnType<typeof parsedLineToBubble>[]>([]);
const errors = ref<string[]>([]);
const input = ref('');
const sending = ref(false);
let stream: ReturnType<typeof followSse> | undefined;
let approvalsStream: EventSource | undefined;
const bottom = ref<HTMLElement | undefined>();

// Opened from search (?q=): keep the keywords highlighted in the live
// stream — re-run after every render because v-html resets the DOM.
const searchTerms = queryTerms(typeof route.query['q'] === 'string' ? route.query['q'] : '');
watch(bubbles, async () => {
  if (searchTerms.length === 0) return;
  await nextTick();
  const stream = bottom.value?.parentElement;
  if (stream) highlightKeywordsInElement(stream, searchTerms);
});

function pushBubble(line: ParsedLine): void {
  const bubble = parsedLineToBubble(line);
  if (bubble) bubbles.value.push(bubble);
  void nextTick(() => bottom.value?.scrollIntoView({ behavior: 'smooth' }));
}

function handleApprovalEvent(data: string): void {
  try {
    const frame = JSON.parse(data) as ToolApprovalRequest | ApprovalSettledFrame;
    if ('toolName' in frame) {
      approvals.ingest(frame);
    } else {
      approvals.removeById(frame.approvalId); // decided elsewhere or timed out — drop the ghost card
    }
  } catch {
    // malformed frame — ignore
  }
}

// The tailed JSONL stream owns bubble rendering (user + assistant), so the
// POST response is only consulted for errors — rendering both would duplicate
// every bubble. The user bubble comes from the tail when the SDK writes it.
async function send(force = false): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  if (!force) input.value = '';
  try {
    await readSsePost(`/api/sessions/${sessionId}/messages`, { text, force }, (data) => {
      const message = postEventError(JSON.parse(data) as Parameters<typeof postEventError>[0]);
      if (message) errors.value.push(message);
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.body['error'] === 'session_active') {
      try {
        await showConfirmDialog({ message: '会话近期仍有写入（可能本地 TUI 正在跑）。强制续聊？' });
        await send(true);
      } catch {
        // user declined the force resend
      }
    } else {
      errors.value.push(error instanceof Error ? error.message : String(error));
    }
  } finally {
    sending.value = false;
  }
}

// Recent-history window: pulling a 20MB session from byte 0 floods the phone
// and the tunnel; the last 256KB (~dozens of screens) is what a person reads.
const TAIL_BYTES = 262_144;
const fullHistory = ref(false);

function connectStream(): void {
  stream?.close();
  bubbles.value = [];
  const tail = fullHistory.value ? '' : `&tailBytes=${TAIL_BYTES}`;
  // followSse owns reconnection: a dropped tunnel must reset the view, not
  // append a replayed copy of the tail the way EventSource auto-reconnect does.
  stream = followSse(sseUrl(`/api/sessions/${sessionId}/stream?fromStart=true${tail}`), {
    onLine: (data) => pushBubble(JSON.parse(data) as ParsedLine),
    onReset: () => {
      bubbles.value = [];
      errors.value = [];
    },
  });
}

function loadFullHistory(): void {
  fullHistory.value = true;
  connectStream();
}

onMounted(() => {
  connectStream();
  approvalsStream = new EventSource(sseUrl('/api/approvals/stream'));
  approvalsStream.onmessage = (event) => handleApprovalEvent(event.data);
});
onUnmounted(() => {
  stream?.close();
  approvalsStream?.close();
});
</script>

<template>
  <div class="page session">
    <div class="stream">
      <div v-for="(bubble, i) in bubbles" :key="i" :class="['bubble', bubble?.kind === 'text' ? bubble.role : bubble?.kind]">
        <!-- Assistant replies are markdown-heavy; render them. User input is
             conversational text and slash commands — keep it plain so it is
             never misparsed. -->
        <div v-if="bubble?.kind === 'text' && bubble.role === 'assistant'" class="md-body" v-html="renderMarkdown(bubble.text)"></div>
        <template v-else-if="bubble?.kind === 'text'">{{ bubble.text }}</template>
        <template v-else-if="bubble?.kind === 'tool'">🔧 {{ bubble.name }}</template>
        <template v-else-if="bubble?.kind === 'raw'">{{ bubble.text }}</template>
      </div>
      <ApprovalCard
        v-for="request in approvals.pending.filter((p) => !p.sessionId || p.sessionId === sessionId)"
        :key="request.approvalId"
        :request="request"
      />
      <div v-for="error in errors" :key="error" class="error">{{ error }}</div>
      <div ref="bottom" />
    </div>
    <div class="composer">
      <Button v-if="!fullHistory" size="small" plain @click="loadFullHistory">加载全部历史</Button>
      <Field v-model="input" placeholder="续聊…" rows="1" autosize />
      <Button type="primary" :loading="sending" @click="send">发送</Button>
    </div>
  </div>
</template>

<style scoped>
/* Fill the viewport minus the 50px tabbar (plus iOS safe area) so the
   composer sits flush on top of the tabbar. */
.session { display: flex; flex-direction: column; height: calc(100vh - 50px - env(safe-area-inset-bottom, 0px)); padding-bottom: 0; }
.stream { flex: 1; overflow-y: auto; padding: 12px; }
.bubble { margin: 6px 0; padding: 8px 12px; border-radius: var(--cc-radius); background: #f2f3f5; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: #1989fa; color: white; }
.bubble.tool { background: #fffbe8; font-size: 12px; }
.bubble.raw { background: #f7f7f7; color: #969799; font-size: 12px; }
.error { color: var(--cc-danger); font-size: 12px; }
.composer { display: flex; gap: 8px; padding: 8px; align-items: center; background: var(--cc-surface, #fff); }
.composer :deep(.van-field) { flex: 1; }
</style>
