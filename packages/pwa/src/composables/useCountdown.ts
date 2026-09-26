import { onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';

export function useCountdown(deadlineMs: number, intervalMs = 1000): { remaining: Ref<number> } {
  const remaining = ref(Math.max(0, deadlineMs - Date.now()));
  const timer = setInterval(() => {
    remaining.value = Math.max(0, deadlineMs - Date.now());
  }, intervalMs);
  onUnmounted(() => clearInterval(timer));
  return { remaining };
}
