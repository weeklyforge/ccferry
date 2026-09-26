<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, Field, showFailToast, showSuccessToast } from 'vant';
import { apiFetch } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const content = ref('');
const saving = ref(false);
// Notes open in the rendered reading view; editing is an explicit switch.
const mode = ref<'read' | 'edit'>('read');
// A failed load leaves content empty; saving then would overwrite the note
// with nothing. Keep Save disabled until real content has been read.
const loadFailed = ref(true);
const rendered = computed(() => renderMarkdown(content.value));

onMounted(async () => {
  const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(props.path)}`);
  if (res.ok) {
    content.value = (await res.json())['content'] as string;
    loadFailed.value = false;
  } else {
    showFailToast('读取失败，已禁用保存以防覆盖');
  }
});

async function save(): Promise<void> {
  saving.value = true;
  try {
    const res = await apiFetch('/api/vault/file', {
      method: 'PUT',
      body: JSON.stringify({ path: props.path, content: content.value }),
    });
    if (res.ok) {
      showSuccessToast('已保存（obsidian-git 兜底留痕）');
      mode.value = 'read';
    } else showFailToast('保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="editor">
    <div class="path">{{ path }}</div>
    <div v-if="mode === 'read'" class="md-body note-view" v-html="rendered"></div>
    <Field v-else v-model="content" type="textarea" rows="16" autosize />
    <div class="row">
      <Button plain @click="emit('close')">关闭</Button>
      <Button v-if="mode === 'read'" type="primary" @click="mode = 'edit'">编辑</Button>
      <Button v-else type="primary" :loading="saving" :disabled="loadFailed" @click="save">保存</Button>
    </div>
  </div>
</template>

<style scoped>
.editor { padding: 8px; }
.path { font-size: 12px; color: #969799; padding: 4px 0; }
.note-view { min-height: 200px; max-height: calc(100vh - 280px); overflow-y: auto; background: #fff; border: 1px solid var(--cc-border); border-radius: var(--cc-radius); padding: 12px; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
</style>
