<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, NavBar, Search, showFailToast } from 'vant';
import type { VaultNode, VaultSearchMatch } from '@ccferry/protocol';
import NoteEditor from '../components/NoteEditor.vue';
import { apiFetch } from '../lib/api';
import { debounce } from '../lib/debounce';

const router = useRouter();
const stack = ref<VaultNode[][]>([]);
const names = ref<string[]>([]);
const query = ref('');
const matches = ref<VaultSearchMatch[] | null>(null);
const editing = ref<string | null>(null);
const creating = ref(false);
const newNotePath = ref('');

const title = computed(() => names.value[names.value.length - 1] ?? '知识库');

const current = () => stack.value[stack.value.length - 1] ?? [];

async function openRoot(): Promise<void> {
  const res = await apiFetch('/api/vault/tree');
  if (res.status === 503) {
    names.value = ['知识库（未配置）'];
    stack.value = [];
    return;
  }
  const body = await res.json();
  stack.value = [body['tree'] as VaultNode[]];
  names.value = [];
}

function enter(node: VaultNode): void {
  if (node.kind === 'dir') {
    stack.value.push(node.children ?? []);
    names.value.push(node.name);
    matches.value = null;
  } else {
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
  editing.value = match.path;
}

onMounted(() => void openRoot());
</script>

<template>
  <div class="page">
    <NavBar :title="title" left-arrow @click-left="back" />
    <Search v-model="query" placeholder="搜索笔记" @update:model-value="runSearch" />
    <div v-if="creating" class="create-row">
      <Field v-model="newNotePath" placeholder="路径，如 工作日报/2026-09/新笔记.md" />
      <Button size="small" type="primary" @click="createNote">创建</Button>
    </div>
    <NoteEditor v-if="editing !== null" :path="editing" @close="editing = null" />
    <CellGroup v-else-if="matches !== null">
      <Cell
        v-for="match in matches"
        :key="match.path + match.line"
        :title="match.path"
        :label="`${match.line}: ${match.text}`"
        is-link
        @click="openMatch(match)"
      />
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
  </div>
</template>

<style scoped>
.create-row { display: flex; gap: 8px; padding: 8px; align-items: center; }
.new-note { margin: 8px; width: calc(100% - 16px); }
</style>
