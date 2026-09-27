// A new task's POST streams the whole first agent turn; waiting for it to
// end means any screen lock or network blip reports failure while the task
// actually runs on the PC. Resolve on the FIRST streamed event instead —
// it proves the session started — and treat post-start stream drops as
// success (the SDK keeps running server-side).
export async function awaitStart(
  stream: (onEvent: (data: string) => void) => Promise<void>,
  onFirstEvent: () => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let seen = false;
    void stream(() => {
      if (!seen) {
        seen = true;
        onFirstEvent();
        resolve();
      }
    }).catch((error) => {
      if (!seen) reject(error); // failed before the session started
      // else: post-start drop — the task continues on the PC
    });
  });
}

interface SessionRow {
  sessionId: string;
  projectPath: string;
  lastModifiedMs: number;
}

// The new session's id only reaches the stream at the END of the first
// agent turn; the session FILE, though, shows up in the store within a
// scan cycle. Poll the store for it so the app can jump straight into the
// conversation (null on timeout — caller falls back to the list).
export async function waitForNewSession(
  list: () => Promise<SessionRow[]>,
  projectPath: string,
  sinceMs: number,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const pollMs = opts.pollMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  for (;;) {
    try {
      const hit = (await list()).find(
        (s) => s.projectPath === projectPath && s.lastModifiedMs >= sinceMs - 1000,
      );
      if (hit) return hit.sessionId;
    } catch {
      // transient list failure — keep polling until the deadline
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
