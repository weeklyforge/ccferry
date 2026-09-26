const BASE_MS = 1000;
const MAX_MS = 60_000;
const JITTER = 0.2;

export function nextDelayMs(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, attempt);
  const exponential = Math.min(BASE_MS * 2 ** safeAttempt, MAX_MS);
  return Math.round(exponential * (1 - JITTER + 2 * JITTER * random()));
}
