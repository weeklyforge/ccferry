<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button, Cell, CellGroup, Field, showFailToast, showSuccessToast } from 'vant';
import { apiFetch } from '../lib/api';
import { clientId } from '../lib/client-id';
import { urlBase64ToUint8Array } from '../lib/push';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const tokenInput = ref(auth.token);
const vaultStatus = ref('检测中…');
const pushStatus = ref('未开启');
const pushSubscribed = ref(false);

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

async function enablePush(): Promise<void> {
  try {
    const keyRes = await apiFetch('/api/push/key');
    if (keyRes.status === 503) {
      pushStatus.value = '云端未配置推送';
      return;
    }
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      pushStatus.value = '未获得通知权限';
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ clientId: clientId(), endpoint: json.endpoint, keys: json.keys }),
    });
    if (res.ok) {
      pushStatus.value = '已订阅';
      pushSubscribed.value = true;
    } else pushStatus.value = '订阅失败';
  } catch {
    pushStatus.value = '推送不可用（需加主屏后重试）';
  }
}

async function testPush(): Promise<void> {
  const res = await apiFetch('/api/push/test', { method: 'POST' });
  if (res.ok) showSuccessToast('已发送，留意通知');
  else showFailToast('发送失败');
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
    <CellGroup title="推送">
      <Cell title="状态" :value="pushStatus" />
      <Cell title="">
        <template #value>
          <Button size="small" type="primary" @click="enablePush">开启推送</Button>
          <Button v-if="pushSubscribed" size="small" plain style="margin-left: 8px" @click="testPush">测试推送</Button>
        </template>
      </Cell>
    </CellGroup>
  </div>
</template>
