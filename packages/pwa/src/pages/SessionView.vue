<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Field } from 'vant';
import type { DriverEvent, ParsedLine, ToolApprovalRequest } from '@ccferry/protocol';
import { readSsePost, sseUrl } from '../lib/api';
import { useApprovalsStore } from '../stores/approvals';
import { parsedLineToBubble } from '../lib/bubbles';
import ApprovalCard from '../components/ApprovalCard.vue';

const route = useRoute();
const sessionId = route.params['id'] as string;
const approvals = useApprovalsStore();
const bubbles = ref<ReturnType<typeof parsedLineToBubble>[]>([]);
const errors = ref<string[]>([]);
const input = ref('');
const sending = ref(false);
let stream: EventSource | undefined;
let approvalsStream: EventSource | undefined;
const bottom = ref<HTMLElement | undefined>();

function pushBubble(line: ParsedLine): void {
  const bubble = parsedLineToBubble(line);
  if (bubble) bubbles.value.push(bubble);
  void nextTick(() => bottom.value?.scrollIntoView({ behavior: 'smooth' }));
}

function handleApprovalEvent(data: string): void {
  try {
    approvals.ingest(JSON.parse(data) as ToolApprovalRequest);
  } catch {
    // malformed frame — ignore
  }
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  input.value = '';
  bubbles.value.push({ kind: 'text', role: 'user', text });
  try {
    await readSsePost(`/api/sessions/${sessionId}/messages`, { text, force: false }, (data) => {
      const event = JSON.parse(data) as DriverEvent;
      if (event.type === 'error') errors.value.push(event.message);
      else if (event.type === 'assistant') bubbles.value.push({ kind: 'text', role: 'assistant', text: event.text });
    });
  } catch (error) {
    errors.value.push(String(error));
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  stream = new EventSource(sseUrl(`/api/sessions/${sessionId}/stream?fromStart=true`));
  stream.onmessage = (event) => pushBubble(JSON.parse(event.data) as ParsedLine);
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
        <template v-if="bubble?.kind === 'text'">{{ bubble.text }}</template>
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
      <Field v-model="input" placeholder="续聊…" rows="1" autosize />
      <Button type="primary" :loading="sending" @click="send">发送</Button>
    </div>
  </div>
</template>

<style scoped>
.session { display: flex; flex-direction: column; height: calc(100vh - 100px); }
.stream { flex: 1; overflow-y: auto; padding: 12px; }
.bubble { margin: 6px 0; padding: 8px 12px; border-radius: 8px; background: #f2f3f5; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.bubble.user { background: #1989fa; color: white; }
.bubble.tool { background: #fffbe8; font-size: 12px; }
.bubble.raw { background: #f7f7f7; color: #969799; font-size: 12px; }
.error { color: #ee0a24; font-size: 12px; }
.composer { display: flex; gap: 8px; padding: 8px; align-items: center; }
</style>
