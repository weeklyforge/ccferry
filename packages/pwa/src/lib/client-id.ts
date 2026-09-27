function randomId(): string {
  // randomUUID is secure-context-only; the LAN http deployment needs a
  // fallback so devices never collapse onto one shared id (which would
  // cross-suppress pushes across devices).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

// Stable per-browser id correlating the push subscription with the
// foreground SSE connection (spec D6): the cloud suppresses pushes to
// clients whose event stream is live.
export function clientId(): string {
  try {
    const existing = localStorage.getItem('ccferry-client-id');
    if (existing) return existing;
    const fresh = randomId();
    localStorage.setItem('ccferry-client-id', fresh);
    return fresh;
  } catch {
    // storage unavailable (private mode): a per-load id keeps THIS session
    // consistent; suppression just never persists across loads
    return randomId();
  }
}
