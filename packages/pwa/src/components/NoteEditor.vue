<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, Field, Toast } from 'vant';
import { apiFetch } from '../lib/api';

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const content = ref('');
const saving = ref(false);

onMounted(async () => {
  const res = await apiFetch(`/api/vault/file?path=${encodeURIComponent(props.path)}`);
  if (res.ok) content.value = (await res.json())['content'] as string;
  else Toast.fail('读取失败');
});

async function save(): Promise<void> {
  saving.value = true;
  try {
    const res = await apiFetch('/api/vault/file', {
      method: 'PUT',
      body: JSON.stringify({ path: props.path, content: content.value }),
    });
    if (res.ok) Toast.success('已保存（obsidian-git 兜底留痕）');
    else Toast.fail('保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="editor">
    <div class="path">{{ path }}</div>
    <Field v-model="content" type="textarea" rows="16" autosize />
    <div class="row">
      <Button plain @click="emit('close')">关闭</Button>
      <Button type="primary" :loading="saving" @click="save">保存</Button>
    </div>
  </div>
</template>

<style scoped>
.editor { padding: 8px; }
.path { font-size: 12px; color: #969799; padding: 4px 0; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
</style>
