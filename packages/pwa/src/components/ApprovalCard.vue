<script setup lang="ts">
import { computed } from 'vue';
import { Button, showFailToast } from 'vant';
import type { ApprovalDecision, ToolApprovalRequest } from '@ccferry/protocol';
import { useApprovalsStore } from '../stores/approvals';
import { useCountdown } from '../composables/useCountdown';

const props = defineProps<{ request: ToolApprovalRequest }>();
const approvals = useApprovalsStore();
const { remaining } = useCountdown(props.request.createdAtMs + props.request.timeoutMs);
const seconds = computed(() => Math.ceil(remaining.value / 1000));
const inputPreview = computed(() => JSON.stringify(props.request.input).slice(0, 600));

function decide(decision: ApprovalDecision): void {
  void approvals.decide(props.request.approvalId, decision).catch(() => {
    showFailToast('决断未送达，请重试');
  });
}
</script>

<template>
  <div class="approval-card">
    <div class="title">权限请求：{{ request.toolName }}</div>
    <pre class="input">{{ inputPreview }}</pre>
    <div class="row">
      <span class="countdown">{{ seconds }}s 后自动拒绝</span>
      <Button size="small" type="danger" plain @click="decide('deny')">拒绝</Button>
      <Button size="small" type="primary" @click="decide('allow')">允许</Button>
    </div>
  </div>
</template>

<style scoped>
.approval-card { border: 1px solid #ee0a24; border-radius: 8px; padding: 8px; margin: 8px 0; }
.title { font-weight: bold; }
.input { font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow: auto; }
.row { display: flex; gap: 8px; align-items: center; }
.countdown { color: #ee0a24; font-size: 12px; margin-right: auto; }
</style>
