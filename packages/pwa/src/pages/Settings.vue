<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, Cell, CellGroup, Field } from 'vant';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const tokenInput = ref(auth.token);
const vaultStatus = ref('检测中…');

async function probeVault(): Promise<void> {
  try {
    const res = await apiFetch('/api/vault/tree');
    vaultStatus.value = res.ok ? '已连接' : '未配置（503）';
  } catch {
    vaultStatus.value = 'daemon 不可达';
  }
}

function saveToken(): void {
  auth.setToken(tokenInput.value.trim());
  window.location.reload();
}

onMounted(() => void probeVault());
</script>

<template>
  <div class="page">
    <CellGroup title="认证">
      <Field v-model="tokenInput" placeholder="访问令牌 (CCFERRY_TOKEN)" clearable />
      <Cell title="">
        <template #value>
          <Button size="small" type="primary" @click="saveToken">保存并重载</Button>
        </template>
      </Cell>
    </CellGroup>
    <CellGroup title="状态">
      <Cell title="daemon 地址" :value="auth.daemonBase" />
      <Cell title="知识库" :value="vaultStatus" />
    </CellGroup>
  </div>
</template>
