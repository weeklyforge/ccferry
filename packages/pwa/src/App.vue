<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { Tabbar, TabbarItem } from 'vant';
import { useRoute } from 'vue-router';
import { sseUrl } from './lib/api';
import { clientId } from './lib/client-id';
import { followSse } from './lib/sse-follow';
import { useApprovalsStore } from './stores/approvals';

const route = useRoute();
const approvals = useApprovalsStore();
let events: ReturnType<typeof followSse> | undefined;

// Foreground event stream (spec D6): while the app is visible this stays
// connected — feeding approvals live AND marking this client as foreground
// so the cloud suppresses pushes to it. Hidden tab closes the stream.
function connectEvents(): void {
  events?.close();
  events = followSse(sseUrl(`/api/events/stream?clientId=${encodeURIComponent(clientId())}`), {
    onLine: (data) => {
      try {
        const frame = JSON.parse(data) as {
          kind?: string;
          request?: { approvalId: string; sessionId: string | null; toolName: string; input: Record<string, unknown>; createdAtMs: number; timeoutMs: number };
          approvalId?: string;
        };
        if (frame.kind === 'approval' && frame.request) approvals.ingest(frame.request);
        else if (frame.kind === 'settled' && frame.approvalId) approvals.removeById(frame.approvalId);
      } catch {
        // malformed event — ignore
      }
    },
    onReset: () => undefined, // snapshot replay is idempotent (ingest upserts)
  });
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') connectEvents();
  else {
    events?.close();
    events = undefined;
  }
}

onMounted(() => {
  onVisibility();
  document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  events?.close();
});
</script>

<template>
  <router-view :key="route.fullPath" />
  <Tabbar route placeholder>
    <TabbarItem replace to="/" icon="chat-o">会话</TabbarItem>
    <TabbarItem replace to="/vault" icon="notes-o">知识库</TabbarItem>
    <TabbarItem replace to="/settings" icon="setting-o">设置</TabbarItem>
  </Tabbar>
</template>
