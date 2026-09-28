<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, Loading, NavBar, Search, showFailToast } from 'vant';
import type { VaultNode, VaultSearchMatch } from '@ccferry/protocol';
import NoteEditor from '../components/NoteEditor.vue';
import GuideCard from '../components/GuideCard.vue';
import { apiFetch } from '../lib/api';
import { highlightSegments } from '../lib/highlight';
import { debounce } from '../lib/debounce';

defineOptions({ name: 'Vault' });

const router = useRouter();
const stack = ref<VaultNode[][]>([]);
const names = ref<string[]>([]);
const query = ref('');
const matches = ref<VaultSearchMatch[] | null>(null);
const editing = ref<string | null>(null);
const unauthorized = ref(false);
const loading = ref(true);
// Captured when opening a search hit so the note view can highlight terms.
const matchQuery = ref('');
const creating = ref(false);
const newNotePath = ref('');

const title = computed(() => names.value[names.value.length - 1] ?? '知识库');

const current = () => stack.value[stack.value.length - 1] ?? [];

async function openRoot(): Promise<void> {
  loading.value = true;
  const res = await apiFetch('/api/vault/tree');
  unauthorized.value = res.status === 401;
  if (res.status === 503) {
    names.value = ['知识库（未配置）'];
    stack.value = [];
    loading.value = false;
    return;
  }
  if (!res.ok) {
    loading.value = false;
    return;
  }
  const body = await res.json();
  stack.value = [body['tree'] as VaultNode[]];
  names.value = [];
  loading.value = false;
}

function enter(node: VaultNode): void {
  if (node.kind === 'dir') {
    stack.value.push(node.children ?? []);
    names.value.push(node.name);
    matches.value = null;
  } else {
    matchQuery.value = ''; // browsed, not searched — no highlight
    editing.value = node.path;
  }
}

function back(): void {
  if (editing.value !== null) {
    editing.value = null;
    return;
  }
  if (creating.value) {
    creating.value = false;
    return;
  }
  if (matches.value !== null) {
    matches.value = null;
    return;
  }
  if (stack.value.length > 1) {
    stack.value.pop();
    names.value.pop();
  } else {
    router.back();
  }
}

const runSearch = debounce(async (q: string) => {
  if (!q.trim()) {
    matches.value = null;
    return;
  }
  const res = await apiFetch(`/api/vault/search?q=${encodeURIComponent(q)}`);
  if (res.ok) matches.value = (await res.json())['matches'] as VaultSearchMatch[];
}, 300);

async function createNote(): Promise<void> {
  const path = newNotePath.value.trim();
  if (!path.endsWith('.md')) {
    showFailToast('路径必须以 .md 结尾');
    return;
  }
  const res = await apiFetch('/api/vault/file', { method: 'POST', body: JSON.stringify({ path, content: '' }) });
  if (res.ok) {
    creating.value = false;
    editing.value = path;
  } else if (res.status === 409) {
    showFailToast('笔记已存在');
  }
}

function openMatch(match: VaultSearchMatch): void {
  matchQuery.value = query.value; // carry the search terms into the note
  editing.value = match.path;
}

onMounted(() => void openRoot());
// KeepAlive: coming back to the tab shows the cached tree (and drill-down
// position) instantly; refresh the listing in the background only when we
// sit at the root, so a drilled-in position is never reset under the user.
onActivated(() => {
  if (stack.value.length <= 1) void openRoot();
});
</script>

<template>
  <div class="page">
    <NavBar :title="title" left-arrow fixed placeholder @click-left="back" />
    <GuideCard
      v-if="unauthorized"
      title="尚未授权"
      description="先到「设置」页保存访问令牌，即可浏览你的知识库"
    />
    <template v-else>
      <Search v-model="query" placeholder="搜索笔记" @update:model-value="runSearch" />
      <div v-if="loading" class="loading-wrap">
        <Loading size="24" vertical>加载中…</Loading>
      </div>
      <div v-else-if="creating" class="create-row">
        <Field v-model="newNotePath" placeholder="路径，如 工作日报/2026-09/新笔记.md" />
        <Button size="small" type="primary" @click="createNote">创建</Button>
      </div>
      <NoteEditor v-else-if="editing !== null" :path="editing" :highlight-query="matchQuery" @close="editing = null" />
      <CellGroup v-else-if="matches !== null">
        <Cell
          v-for="match in matches"
          :key="match.path + match.line"
          :title="match.path"
          is-link
          @click="openMatch(match)"
        >
          <!-- Segments (not v-html) keep arbitrary note text unescaped-safe. -->
          <template #label>
            <span class="match-line">{{ match.line }}:
              <template v-for="(seg, i) in highlightSegments(match.text, query)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
            </span>
          </template>
        </Cell>
        <Cell v-if="matches.length === 0" title="（无结果）" />
      </CellGroup>
      <CellGroup v-else>
        <Cell v-for="node in current()" :key="node.path" :title="node.name" :is-link="node.kind === 'dir'" @click="enter(node)">
          <template #value>
            <span v-if="node.kind === 'file'">{{ Math.ceil((node.sizeBytes ?? 0) / 1024) }}KB</span>
          </template>
        </Cell>
      </CellGroup>
      <Button block plain type="primary" class="new-note" @click="creating = true">新建笔记</Button>
    </template>
  </div>
</template>

<style scoped>
.loading-wrap { display: flex; justify-content: center; padding: 80px 0; }
.create-row { display: flex; gap: 8px; padding: 8px; align-items: center; }
.new-note { margin: 8px; width: calc(100% - 16px); }
</style>
