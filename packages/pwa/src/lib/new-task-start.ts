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
