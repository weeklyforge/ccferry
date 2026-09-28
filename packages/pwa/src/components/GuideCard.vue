<script setup lang="ts">
import { Button, Empty } from 'vant';
import { useRouter } from 'vue-router';

defineProps<{ title: string; description?: string }>();

const router = useRouter();
</script>

<template>
  <div class="guide">
    <Empty :description="title">
      <p v-if="description" class="guide-desc">{{ description }}</p>
      <Button type="primary" size="small" @click="router.push('/settings')">去设置令牌</Button>
    </Empty>
  </div>
</template>

<style scoped>
.guide { padding-top: 15vh; }
.guide-desc { margin: 0 0 12px; font-size: 13px; color: var(--cc-text-secondary, #969799); }
</style>
