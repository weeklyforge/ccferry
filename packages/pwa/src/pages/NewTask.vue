<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, NavBar, Picker, Popup, showFailToast, showSuccessToast } from 'vant';
import { ApiError, apiFetch, readSsePost } from '../lib/api';
import { awaitStart, waitForNewSession } from '../lib/new-task-start';
import { shortProject } from '../lib/project-name';

defineOptions({ name: 'NewTask' });

const router = useRouter();
const text = ref('');
const sending = ref(false);
const picking = ref(false);
const projects = ref<Array<{ text: string; value: string }>>([]);
const project = ref('');

onMounted(async () => {
  const res = await apiFetch('/api/projects');
  if (res.ok) {
    const body = (await res.json()) as { projects: Array<{ projectPath: string }> };
    projects.value = body.projects.map((p) => ({ text: shortProject(p.projectPath), value: p.projectPath }));
  }
});

function confirmPick({ selectedOptions }: { selectedOptions: Array<{ text: string; value: string }> }): void {
  project.value = selectedOptions[0]?.value ?? '';
  picking.value = false;
}

async function start(): Promise<void> {
  if (!project.value || !text.value.trim() || sending.value) return;
  sending.value = true;
  const startedAt = Date.now();
  try {
    // Resolve on the FIRST streamed event: the POST streams the whole first
    // agent turn, and waiting for it means a screen lock or network blip
    // reports failure while the task actually runs on the PC.
    await awaitStart(
      (onEvent) => readSsePost('/api/messages', { projectPath: project.value, text: text.value.trim() }, onEvent),
      () => undefined,
    );
    showSuccessToast('已创建，正在打开会话…');
    // The session id only reaches the stream at the end of the turn; watch
    // the store instead and jump into the conversation as soon as it lands.
    void (async () => {
      const list = async (): Promise<Array<{ sessionId: string; projectPath: string; lastModifiedMs: number }>> => {
        const res = await apiFetch('/api/sessions');
        return res.ok ? ((await res.json()) as Array<{ sessionId: string; projectPath: string; lastModifiedMs: number }>) : [];
      };
      const id = await waitForNewSession(list, project.value, startedAt, { timeoutMs: 30_000 });
      void router.replace(id ? `/session/${id}` : '/');
    })();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) showFailToast('该项目不在允许列表中');
    else showFailToast('创建失败，请重试');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="page">
    <NavBar title="新任务" fixed placeholder />
    <CellGroup title="项目">
      <Cell title="选择项目" :value="project ? shortProject(project) : '未选择'" is-link @click="picking = true" />
    </CellGroup>
    <Field v-model="text" type="textarea" rows="4" autosize placeholder="首条指令，描述要做的任务…" />
    <Button block type="primary" :loading="sending" :disabled="!project || !text.trim()" @click="start">开始任务</Button>
    <Popup v-model:show="picking" position="bottom" round>
      <Picker :columns="projects" @confirm="confirmPick" @cancel="picking = false" />
    </Popup>
  </div>
</template>
