// Time budgets for one unit of work inside an execution segment
// (lib/manager/taskRunner.ts, SEGMENT_BUDGET_MS = 265s). Each worker attempt
// and each QA call runs under its own nested deadline (lib/runtime/
// deadline.ts runWithBudget), so a single slow model call can't consume a
// whole segment - observed attempts by the same agent ranged from under a
// minute to over two. An attempt is only started when the segment can fit
// its full budget.
//
// Invariants:
//  - the longest single Sarvam call (lib/manager/sarvam.ts, 110s) plus a web
//    search pass (<=30s) fits in ATTEMPT_EXEC_BUDGET_MS;
//  - ATTEMPT_START_WINDOW_MS leaves >= 45s of a fresh segment for its own
//    startup (planning, recovery), so a fresh segment can always start work
//    and the task can never stall yielding forever.
export const ATTEMPT_EXEC_BUDGET_MS = 150_000;
export const QA_BUDGET_MS = 40_000;
export const ATTEMPT_WINDOW_MS = ATTEMPT_EXEC_BUDGET_MS + QA_BUDGET_MS + 10_000;
// Extra room before hiring (discovery, bids, escrow lock) for a step's first attempt.
export const ATTEMPT_START_WINDOW_MS = ATTEMPT_WINDOW_MS + 20_000;
