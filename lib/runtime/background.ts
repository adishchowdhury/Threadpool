import { withTimeout } from "@/lib/runtime/deadline";

// Best-effort side effects that must never sit on a task's critical path -
// chiefly the Algorand trust layer (anchoring proofs, mirroring ledger
// transfers as x402 payments), which waits on real block confirmations and
// third-party facilitators. CLAUDE.md: the internal ledger is authoritative
// and blockchain must not be a dependency of the workflow. Jobs start
// immediately and run concurrently with the workflow; whoever owns the
// invocation calls drainBackground() before it ends so they get a chance to
// finish. A job that fails or times out only logs - its DB record keeps an
// honest PENDING/FAILED status.

const pending = new Set<Promise<void>>();

export function runInBackground(label: string, job: () => Promise<unknown>, timeoutMs = 60_000): void {
  const tracked: Promise<void> = (async () => {
    try {
      await withTimeout(job(), timeoutMs, label);
    } catch (err) {
      console.error(`[background] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })().finally(() => pending.delete(tracked));
  pending.add(tracked);
}

export async function drainBackground(maxWaitMs: number): Promise<{ unfinished: number }> {
  if (pending.size > 0 && maxWaitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  return { unfinished: pending.size };
}
