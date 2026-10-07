import { AsyncLocalStorage } from "node:async_hooks";

// A task runs in bounded "segments", each inside one serverless invocation
// with a hard wall-clock limit (lib/manager/taskRunner.ts). The deadline is
// carried implicitly through AsyncLocalStorage so every network call made on
// the task's behalf (Sarvam, web search, page fetches, x402) can clamp its
// own timeout to what the invocation actually has left - without threading a
// parameter through every capability runtime. Outside a segment (scripts,
// calibration, other routes) there is no deadline and timeouts are unchanged.

type DeadlineContext = { hardDeadline: number; exhausted: boolean };

const storage = new AsyncLocalStorage<DeadlineContext>();

// Below this, starting a network call is pointless: it would be aborted
// before it could return anything useful.
const MIN_USEFUL_CALL_MS = 4_000;
// A call whose clamped timeout fires lands within this window of the hard
// deadline - used to recognise "this result was cut short by the deadline".
const EXHAUSTION_WINDOW_MS = 6_000;

export class DeadlineExceededError extends Error {
  constructor(message = "execution segment deadline reached") {
    super(message);
    this.name = "DeadlineExceededError";
  }
}

export function runWithDeadline<T>(hardDeadline: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ hardDeadline, exhausted: false }, fn);
}

// Runs `fn` under a tighter, nested deadline: min(current deadline, now +
// budgetMs). Used to bound a single unit of work (one worker attempt, one QA
// call) so it can't consume the whole segment; when the budget runs out, the
// calls inside are clamped/aborted and the capability's own fallbacks take
// over. Exhaustion of the nested budget does not mark the outer segment
// exhausted.
export function runWithBudget<T>(budgetMs: number, fn: () => Promise<T>): Promise<T> {
  const outer = storage.getStore();
  const hardDeadline = Math.min(outer?.hardDeadline ?? Number.POSITIVE_INFINITY, Date.now() + budgetMs);
  return storage.run({ hardDeadline, exhausted: false }, fn);
}

export function remainingMs(): number {
  const ctx = storage.getStore();
  return ctx ? ctx.hardDeadline - Date.now() : Number.POSITIVE_INFINITY;
}

// Clamp a call's natural timeout to the time left in the segment. Throws
// (and flags the segment as exhausted) when there isn't enough left to make
// the call at all.
export function clampTimeout(naturalMs: number, marginMs = 3_000): number {
  const ctx = storage.getStore();
  if (!ctx) return naturalMs;
  const available = ctx.hardDeadline - Date.now() - marginMs;
  if (available < MIN_USEFUL_CALL_MS) {
    ctx.exhausted = true;
    throw new DeadlineExceededError();
  }
  return Math.min(naturalMs, available);
}

// True once the segment can no longer be trusted to have produced complete
// results: a call was refused for lack of time, or we are inside the window
// where clamped timeouts fire. Callers use this to discard (not score) work
// that may have been cut short, and to yield to the next segment instead.
export function deadlineExhausted(): boolean {
  const ctx = storage.getStore();
  if (!ctx) return false;
  return ctx.exhausted || Date.now() >= ctx.hardDeadline - EXHAUSTION_WINDOW_MS;
}

// Races `promise` against `ms`; the loser is left to settle on its own.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
