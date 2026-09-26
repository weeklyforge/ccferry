import type { DriverEvent } from '@ccferry/protocol';

// The POST /messages response and the tailed session stream both carry the
// conversation; rendering both duplicates every bubble. The tailed JSONL
// stream owns user/assistant rendering — the POST response is only consulted
// for errors (and completion, which needs no bubble).
export function postEventError(event: DriverEvent): string | null {
  return event.type === 'error' ? event.message : null;
}
