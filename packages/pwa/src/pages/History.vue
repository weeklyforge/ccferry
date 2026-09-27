<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Cell, CellGroup, NavBar, Picker, Popup, Search, Tag } from 'vant';
import { apiFetch } from '../lib/api';
import { highlightSegments } from '../lib/highlight';
import { debounce } from '../lib/debounce';
import { shortProject } from '../lib/project-name';

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
const notice = ref('');
const projects = ref<Array<{ text: string; value: string }>>([]);
const picking = ref<'project' | 'days' | null>(null);

const dayOptions = [
  { text: '全部时间', value: 0 },
  { text: '7 天', value: 7 },
  { text: '30 天', value: 30 },
];

const projectOptions = ref<Array<{ text: string; value: string }>>([{ text: '全部项目', value: '' }]);

function dayLabel(): string {
  return dayOptions.find((o) => o.value === days.value)?.text ?? '全部时间';
}

function projectLabel(): string {
  return project.value ? shortProject(project.value) : '全部项目';
}

// Filters use Popup+Picker (the combination proven on the phone by the
// new-task page) — Vant DropdownMenu froze the tab on real devices.
function onPick(kind: 'project' | 'days'): void {
  picking.value = kind;
}

function confirmProject({ selectedOptions }: { selectedOptions: Array<{ value: string }> }): void {
  project.value = selectedOptions[0]?.value ?? '';
  picking.value = null;
  runSearch();
}

function confirmDays({ selectedOptions }: { selectedOptions: Array<{ value: number }> }): void {
  days.value = selectedOptions[0]?.value ?? 0;
  picking.value = null;
  runSearch();
}

function relative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

// Sequence searches: a slow broad query must never overwrite a newer
// narrow one's results.
let searchSeq = 0;

const runSearch = debounce(async () => {
  const seq = ++searchSeq;
  const q = query.value.trim();
  if (!q) {
    matches.value = [];
    truncated.value = false;
    notice.value = '';
    return;
  }
  const params = new URLSearchParams({ q });
  if (project.value) params.set('project', project.value);
  if (days.value) params.set('days', String(days.value));
  try {
    const res = await apiFetch(`/api/history/search?${params.toString()}`);
    if (seq !== searchSeq) return; // superseded by a newer search
    if (res.ok) {
      const body = (await res.json()) as { matches: HistoryMatch[]; truncated: boolean };
      matches.value = body.matches;
      truncated.value = body.truncated;
      notice.value = '';
    } else {
      notice.value = `搜索失败（${res.status}）`;
    }
  } catch {
    if (seq === searchSeq) notice.value = '搜索失败，请检查网络';
  }
}, 300);

onMounted(async () => {
  try {
    const res = await apiFetch('/api/projects');
    if (res.ok) {
      const body = (await res.json()) as { projects: Array<{ projectPath: string }> };
      const loaded = body.projects.map((p) => ({ text: shortProject(p.projectPath), value: p.projectPath }));
      projects.value = loaded;
      projectOptions.value = [{ text: '全部项目', value: '' }, ...loaded];
    }
  } catch {
    // project filter simply stays empty — search still works unfiltered
  }
});
</script>

<template>
  <div class="page">
    <NavBar title="历史" fixed placeholder />
    <Search v-model="query" placeholder="搜索会话内容与标题" @update:model-value="runSearch" />
    <div class="filters">
      <Tag size="large" plain type="primary" @click="onPick('project')">{{ projectLabel() }}</Tag>
      <Tag size="large" plain type="primary" @click="onPick('days')">{{ dayLabel() }}</Tag>
    </div>
    <div v-if="notice" class="notice">{{ notice }}</div>
    <div v-if="truncated" class="notice">仅扫描了最近部分会话（20MB 上限）——缩小范围可查更早内容</div>
    <CellGroup>
      <Cell
        v-for="m in matches"
        :key="m.sessionId + m.line"
        :title="m.firstUserText || '(无摘要)'"
        is-link
        @click="router.push(`/session/${m.sessionId}?q=${encodeURIComponent(query)}`)"
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
    <Popup :show="picking === 'project'" position="bottom" round @update:show="picking = null">
      <Picker :columns="projectOptions" @confirm="confirmProject" @cancel="picking = null" />
    </Popup>
    <Popup :show="picking === 'days'" position="bottom" round @update:show="picking = null">
      <Picker :columns="dayOptions" @confirm="confirmDays" @cancel="picking = null" />
    </Popup>
  </div>
</template>

<style scoped>
.filters { display: flex; gap: 8px; padding: 8px 12px; }
.notice { padding: 6px 12px; font-size: 12px; color: #ff976a; }
</style>
