<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Cell, CellGroup, DropdownMenu, DropdownItem, NavBar, Search, Tag } from 'vant';
import { apiFetch } from '../lib/api';
import { highlightSegments } from '../lib/highlight';
import { debounce } from '../lib/debounce';

interface HistoryMatch {
  sessionId: string;
  projectPath: string;
  firstUserText: string;
  line: number;
  text: string;
  lastModifiedMs: number;
}

const router = useRouter();
const query = ref('');
const project = ref('');
const days = ref(0);
const matches = ref<HistoryMatch[]>([]);
const truncated = ref(false);
const projects = ref<Array<{ text: string; value: string }>>([]);

function shortProject(p: string): string {
  const parts = p.split('\\');
  return parts[parts.length - 1] ?? p;
}

function relative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

const runSearch = debounce(async () => {
  if (!query.value.trim()) {
    matches.value = [];
    truncated.value = false;
    return;
  }
  const params = new URLSearchParams({ q: query.value.trim() });
  if (project.value) params.set('project', project.value);
  if (days.value) params.set('days', String(days.value));
  const res = await apiFetch(`/api/history/search?${params.toString()}`);
  if (res.ok) {
    const body = (await res.json()) as { matches: HistoryMatch[]; truncated: boolean };
    matches.value = body.matches;
    truncated.value = body.truncated;
  }
}, 300);

onMounted(async () => {
  const res = await apiFetch('/api/projects');
  if (res.ok) {
    const body = (await res.json()) as { projects: Array<{ projectPath: string }> };
    projects.value = body.projects.map((p) => ({ text: shortProject(p.projectPath), value: p.projectPath }));
  }
});
</script>

<template>
  <div class="page">
    <NavBar title="历史" />
    <Search v-model="query" placeholder="搜索会话内容与标题" @update:model-value="runSearch" />
    <DropdownMenu>
      <DropdownItem v-model="project" :options="[{ text: '全部项目', value: '' }, ...projects]" @change="runSearch" />
      <DropdownItem v-model="days" :options="[{ text: '全部时间', value: 0 }, { text: '7 天', value: 7 }, { text: '30 天', value: 30 }]" @change="runSearch" />
    </DropdownMenu>
    <div v-if="truncated" class="notice">仅扫描了最近部分会话（20MB 上限）——缩小范围可查更早内容</div>
    <CellGroup>
      <Cell
        v-for="m in matches"
        :key="m.sessionId + m.line"
        :title="m.firstUserText || '(无摘要)'"
        is-link
        @click="router.push(`/session/${m.sessionId}`)"
      >
        <template #label>
          <span>{{ shortProject(m.projectPath) }} · {{ relative(m.lastModifiedMs) }} ·
            <template v-for="(seg, i) in highlightSegments(m.text, query)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
          </span>
        </template>
        <template #value><Tag plain>{{ m.line > 0 ? `行 ${m.line}` : '标题' }}</Tag></template>
      </Cell>
      <Cell v-if="query && matches.length === 0" title="（无结果）" />
    </CellGroup>
  </div>
</template>

<style scoped>
.notice { padding: 6px 12px; font-size: 12px; color: #ff976a; }
</style>
