# M1 Findings

Evidence log for the M1 plan. One section per spike; fill during Tasks 2-4.

## Spike A: GLM endpoint inheritance

- Result: PASS
- Evidence: `init model: glm-5.3[1m]` / `result: OK-GLM` — a plain SDK `query()` (no explicit env or endpoint config) inherited the GLM endpoint from the machine's environment and returned a non-error reply.

## Spike B: SDK cross-store resume

- Result: PASS
- Evidence: `first reply: ACK | session: b564d9f2-7e6e-477e-b4ec-2f501948044f` / `resumed reply: 42` / `SPIKE-B: PASS` — a second `query()` in a separate process, resuming the first session id, recalled the fact stored by the first.

## Spike C: resume fork semantics

- Result: resume appends in place — same session id, same JSONL file grew; no fork, no lineage tracking needed.
- Evidence: `sid1: c40d7182-b2b9-47d2-aa5b-01bd38f07b8d` / `sid2: c40d7182-b2b9-47d2-aa5b-01bd38f07b8d` / `same id: true` / `GREW C:\Users\fetao\.claude\projects\C--Users-fetao-AppData-Local-Temp-ccferry-fork-7ovJSH\c40d7182-b2b9-47d2-aa5b-01bd38f07b8d.jsonl (+497363 bytes)` — exactly one file changed (the original session's), zero new files.
