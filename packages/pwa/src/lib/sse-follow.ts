// EventSource auto-reconnect replays `fromStart=true` streams from the top
// without any reset hook — every drop would append a second copy of the
// tail to the caller's list. Own the reconnect here instead: close the
// browser's source (disabling its auto-retry), reset, retry with exponential
// backoff (a permanent failure — wrong token, daemon down — must not churn
// the tab forever).
export interface SseLikeSource {
  close(): void;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onopen?: (() => void) | null;
}

export interface FollowSseOptions {
  onLine: (data: string) => void;
  onReset: () => void;
  factory?: (url: string) => SseLikeSource;
  retryMs?: number;
  maxRetryMs?: number;
}

export function followSse(url: string, opts: FollowSseOptions): { close(): void } {
  const factory = opts.factory ?? ((u: string) => new EventSource(u) as unknown as SseLikeSource);
  const retryMs = opts.retryMs ?? 2000;
  const maxRetryMs = opts.maxRetryMs ?? 30_000;
  let attempt = 0;
  let closed = false;
  let current: SseLikeSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    current = factory(url);
    current.onopen = (): void => {
      attempt = 0; // healthy again — next drop retries fast
    };
    current.onmessage = (event) => opts.onLine(event.data);
    current.onerror = () => {
      current?.close();
      current = null;
      if (closed) return;
      opts.onReset();
      const delay = Math.min(retryMs * 2 ** attempt, maxRetryMs);
      attempt += 1;
      timer = setTimeout(connect, delay);
    };
  }

  connect();
  return {
    close(): void {
      closed = true;
      clearTimeout(timer);
      current?.close();
      current = null;
    },
  };
}
