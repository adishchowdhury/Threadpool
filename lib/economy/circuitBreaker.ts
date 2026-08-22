// The Circuit Breaker — the deterministic safety boundary of the whole economy.
//
// Rule: LLMs may PROPOSE a transaction. This function is the only authority
// on whether it actually happens. It has zero dependency on any LLM output
// at decision time — it only reads numbers/enums already persisted in the DB.
// Never call this with anything derived live from a model response; the
// caller must have already written the proposal to the DB (Bid, Subtask,
// PayoutRequest, etc.) before this evaluates it.

export const ALLOWED_PURPOSES = [
  "research",
  "writing",
  "report_generation",
  "summarization",
  "quality_verification",
  "market_research",
  "financial_analysis",
  "data_extraction",
  "review",
] as const;

export type AllowedPurpose = (typeof ALLOWED_PURPOSES)[number];

export interface CircuitBreakerInput {
  amount: number;
  purpose: string;
  taskRemainingBudget: number;
  agentStatus: "ACTIVE" | "INACTIVE" | "REVOKED";
  escrowAvailable: number;
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
  if (input.agentStatus !== "ACTIVE") {
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
