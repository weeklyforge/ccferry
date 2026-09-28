<script setup lang="ts">
import { computed } from 'vue';
import { Empty } from 'vant';
import { useRouter } from 'vue-router';

const props = defineProps<{ title: string; description?: string }>();

const router = useRouter();
// The description guides to 「设置」; render that word as an inline link.
const parts = computed(() => {
  const text = props.description ?? '';
  const idx = text.indexOf('「设置」');
  return idx === -1 ? { before: text, after: '' } : { before: text.slice(0, idx), after: text.slice(idx + 4) };
});

function goSettings(): void {
  void router.push('/settings');
}
</script>

<template>
  <div class="guide">
    <Empty :description="title">
      <p v-if="description" class="guide-desc">
        {{ parts.before }}<span class="guide-link" @click="goSettings">「设置」</span>{{ parts.after }}
      </p>
    </Empty>
  </div>
</template>

<style scoped>
.guide { padding-top: 15vh; }
.guide-desc { margin: 0; font-size: 13px; color: var(--cc-text-secondary, #969799); }
.guide-link { color: var(--cc-primary, #1989fa); }
</style>
