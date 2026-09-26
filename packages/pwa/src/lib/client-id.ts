// Stable per-browser id correlating the push subscription with the
// foreground SSE connection (spec D6): the cloud suppresses pushes to
// clients whose event stream is live.
export function clientId(): string {
  try {
    const existing = localStorage.getItem('ccferry-client-id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem('ccferry-client-id', fresh);
    return fresh;
  } catch {
    return 'no-storage'; // private mode: suppression simply never applies
  }
}
