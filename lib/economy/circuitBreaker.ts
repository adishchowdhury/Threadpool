// The Circuit Breaker - the deterministic safety boundary of the whole economy.
//
// Rule: LLMs may PROPOSE a transaction. This function is the only authority
// on whether it actually happens. It has zero dependency on any LLM output
// at decision time - it only reads numbers/enums already persisted in the DB.
// Never call this with anything derived live from a model response; the
// caller must have already written the proposal to the DB (Bid, Subtask,
// PayoutRequest, etc.) before this evaluates it.

import { CAPABILITY_IDS } from "@/lib/capabilities/catalog";

// Escrow purposes = the capabilities the Manager can hire for (plus the
// legacy "research" purpose). Derived from the catalog so adding a
// capability cannot leave its escrow locks silently blocked.
export const ALLOWED_PURPOSES = ["research", ...CAPABILITY_IDS] as const;

export type AllowedPurpose = (typeof ALLOWED_PURPOSES)[number];

export interface CircuitBreakerInput {
  amount: number;
  purpose: string;
  taskRemainingBudget: number;
  agentStatus: "ACTIVE" | "INACTIVE" | "REVOKED";
  escrowAvailable: number;
  // LOCK = hiring (escrow funds for an agent); RELEASE = paying out escrow
  // already locked for it. Defaults to LOCK, the stricter of the two.
  operation?: "LOCK" | "RELEASE";
}

export type CircuitBreakerResult =
  | { decision: "APPROVE" }
  | { decision: "BLOCK"; reason: string };

export function evaluateTransaction(input: CircuitBreakerInput): CircuitBreakerResult {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { decision: "BLOCK", reason: "invalid amount" };
  }
  if (input.amount > input.taskRemainingBudget) {
    return { decision: "BLOCK", reason: "budget exceeded" };
  }
  // Nobody is hired unless ACTIVE. Paying out escrow that was locked while
  // the agent WAS active, for work that passed QA, is still allowed after a
  // soft demotion (INACTIVE is a routing decision - "stop hiring" - not a
  // forfeit of earned pay); blocking it failed whole tasks whose agent was
  // demoted by a parallel step mid-subtask. REVOKED (severe violation) blocks
  // everything.
  const payable = input.agentStatus === "ACTIVE" || (input.operation === "RELEASE" && input.agentStatus === "INACTIVE");
  if (!payable) {
    return { decision: "BLOCK", reason: `agent is ${input.agentStatus.toLowerCase()}` };
  }
  if (input.amount > input.escrowAvailable) {
    return { decision: "BLOCK", reason: "insufficient escrow" };
  }
  if (!ALLOWED_PURPOSES.includes(input.purpose as AllowedPurpose)) {
    return { decision: "BLOCK", reason: "unauthorized purpose" };
  }
  return { decision: "APPROVE" };
}

// Threshold beyond which a single blocked request is considered a severe
// policy violation, permanently revoking the offending agent for the session.
export function isSevereViolation(amount: number, taskRemainingBudget: number): boolean {
  const ceiling = Math.max(taskRemainingBudget, 1);
  return amount > ceiling * 10;
}
