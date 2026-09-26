<script setup lang="ts">
import { computed } from 'vue';
import { Button } from 'vant';
import type { ToolApprovalRequest } from '@ccferry/protocol';
import { useApprovalsStore } from '../stores/approvals';
import { useCountdown } from '../composables/useCountdown';

const props = defineProps<{ request: ToolApprovalRequest }>();
const approvals = useApprovalsStore();
const { remaining } = useCountdown(props.request.createdAtMs + props.request.timeoutMs);
const seconds = computed(() => Math.ceil(remaining.value / 1000));
const inputPreview = computed(() => JSON.stringify(props.request.input).slice(0, 600));
</script>

<template>
  <div class="approval-card">
    <div class="title">权限请求：{{ request.toolName }}</div>
    <pre class="input">{{ inputPreview }}</pre>
    <div class="row">
      <span class="countdown">{{ seconds }}s 后自动拒绝</span>
      <Button size="small" type="danger" plain @click="approvals.decide(request.approvalId, 'deny')">拒绝</Button>
      <Button size="small" type="primary" @click="approvals.decide(request.approvalId, 'allow')">允许</Button>
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
