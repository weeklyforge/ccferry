// EventSource auto-reconnect replays `fromStart=true` streams from the top
// without any reset hook — every drop would append a second copy of the
// tail to the caller's list. Own the reconnect here instead: close the
// browser's source (disabling its auto-retry), reset, retry after a delay.
export interface SseLikeSource {
  close(): void;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface FollowSseOptions {
  onLine: (data: string) => void;
  onReset: () => void;
  factory?: (url: string) => SseLikeSource;
  retryMs?: number;
}

export function followSse(url: string, opts: FollowSseOptions): { close(): void } {
  const factory = opts.factory ?? ((u: string) => new EventSource(u) as unknown as SseLikeSource);
  const retryMs = opts.retryMs ?? 2000;
  let closed = false;
  let current: SseLikeSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    current = factory(url);
    current.onmessage = (event) => opts.onLine(event.data);
    current.onerror = () => {
      current?.close();
      current = null;
      if (closed) return;
      opts.onReset();
      timer = setTimeout(connect, retryMs);
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
