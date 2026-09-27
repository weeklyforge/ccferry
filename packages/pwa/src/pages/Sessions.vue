<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, Collapse, CollapseItem, PullRefresh, Tag, showConfirmDialog, showDialog, showFailToast } from 'vant';
import type { SessionSummary, ToolApprovalRequest } from '@ccferry/protocol';
import { apiFetch, readSsePost } from '../lib/api';
import { useApprovalsStore } from '../stores/approvals';
import { sessionStatus } from '../lib/session-status';
import { shortProject } from '../lib/project-name';

const router = useRouter();
const approvals = useApprovalsStore();
const sessions = ref<SessionSummary[]>([]);
const openGroups = ref<string[]>([]);
const agentText = ref('');
let poll: ReturnType<typeof setInterval> | undefined;

const groups = computed(() => {
  const map = new Map<string, SessionSummary[]>();
  for (const s of sessions.value) {
    const list = map.get(s.projectPath) ?? [];
    list.push(s);
    map.set(s.projectPath, list);
  }
  return [...map.entries()].map(([projectPath, list]) => ({ projectPath, list }));
});

async function refresh(): Promise<void> {
  approvals.sweepExpired();
  const [sessionsRes, approvalsRes] = await Promise.all([
    apiFetch('/api/sessions'),
    apiFetch('/api/approvals'),
  ]);
  if (sessionsRes.ok) sessions.value = await sessionsRes.json();
  if (approvalsRes.ok) {
    for (const request of (await approvalsRes.json())['approvals'] as ToolApprovalRequest[]) {
      approvals.ingest(request);
    }
  }
}

function statusOf(s: SessionSummary): 'awaiting' | 'running' | 'idle' {
  return sessionStatus(s, Date.now(), approvals.pending);
}

async function startVaultSession(): Promise<void> {
  const treeRes = await apiFetch('/api/vault/tree');
  if (!treeRes.ok) {
    void showDialog({ message: '知识库未配置（daemon 端 ~/.ccferry/config.json 缺 vaultPath）' });
    return;
  }
  const vaultRoot = (await treeRes.json())['root'] as string;
  try {
    await readSsePost('/api/messages', { projectPath: vaultRoot, text: agentText.value || '请整理一下最近的笔记' }, () => undefined);
  } catch {
    showFailToast('指令发送失败，请检查网络后重试');
    await refresh();
    return;
  }
  void showDialog({ message: '已创建 vault 会话，请在会话列表打开' });
  await refresh();
}

function confirmAgent(): void {
  void showConfirmDialog({ message: '向知识库发一条整理指令？' })
    .then(startVaultSession)
    .catch(() => undefined); // cancel rejects
}

function relative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

onMounted(() => {
  void refresh();
  poll = setInterval(() => void refresh(), 10_000);
});
onUnmounted(() => poll && clearInterval(poll));
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>会话总览</h2>
      <Button size="small" @click="confirmAgent">agent 整理</Button>
    </div>
    <PullRefresh :model-value="false" @update:model-value="refresh">
      <Collapse v-model="openGroups">
        <CollapseItem v-for="group in groups" :key="group.projectPath" :name="group.projectPath">
          <template #title>
            <div class="project-cell">
              <span class="project-name">{{ shortProject(group.projectPath) }}</span>
              <span class="project-path">{{ group.projectPath }}</span>
            </div>
          </template>
          <Cell
            v-for="s in group.list"
            :key="s.sessionId"
            :title="s.firstUserText || '(无摘要)'"
            :label="relative(s.lastModifiedMs)"
            is-link
            @click="router.push(`/session/${s.sessionId}`)"
          >
            <template #value>
              <Tag v-if="statusOf(s) === 'awaiting'" type="danger">等你批准</Tag>
              <Tag v-else-if="statusOf(s) === 'running'" type="primary">进行中</Tag>
              <Tag v-else plain>空闲</Tag>
            </template>
          </Cell>
        </CollapseItem>
      </Collapse>
    </PullRefresh>
  </div>
</template>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; }
h2 { font-size: 16px; margin: 0; }
.project-cell { display: flex; flex-direction: column; }
.project-name { font-size: 14px; font-weight: 600; }
.project-path { font-size: 11px; color: var(--cc-text-secondary, #969799); word-break: break-all; }
</style>
