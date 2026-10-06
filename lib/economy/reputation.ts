import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { refreshAgentStats } from "@/lib/agents/stats";

// §7 polish: an agent that fails this many attempts in a row (across any
// tasks/subtasks) is auto-demoted ACTIVE -> INACTIVE - reversible, and
// distinct from the permanent severe-violation REVOKE in
// circuitBreaker.ts/escrow.ts, which is untouched by this.
export const CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD = 3;

export interface FailureStreakOutcome {
  consecutiveFailures: number;
  demote: boolean;
}

// Pure, deterministic rule - no DB, no I/O - mirroring circuitBreaker.ts's
// style so the demotion threshold is unit testable without a live agent
// record. Reset the streak on success; otherwise increment it and demote
// once it crosses the threshold, but only while still ACTIVE (an already
// INACTIVE/REVOKED agent has nothing further to demote).
export function evaluateFailureStreak(params: { consecutiveFailures: number; status: "ACTIVE" | "INACTIVE" | "REVOKED"; success: boolean }): FailureStreakOutcome {
  if (params.success) return { consecutiveFailures: 0, demote: false };
  const consecutiveFailures = params.consecutiveFailures + 1;
  const demote = consecutiveFailures >= CONSECUTIVE_FAILURE_DEMOTION_THRESHOLD && params.status === "ACTIVE";
  return { consecutiveFailures, demote };
}

// Deterministic reputation recompute (lib/agents/stats.ts) from everything
// observed about the agent - calibration runs plus job history. Called after every subtask completion (success or failure) -
// never mutated directly by an LLM.
export async function recordPerformanceAndUpdateReputation(params: {
  agentId: string;
  taskId: string;
  subtaskId: string;
  taskType: string;
  capabilities: string[];
  expectedCost: number;
  actualCost: number;
  expectedLatencyMs: number;
  actualLatencyMs: number;
  qaScore: number;
  success: boolean;
}) {
  await db.agentPerformance.create({
    data: {
      agentId: params.agentId,
      taskId: params.taskId,
      subtaskId: params.subtaskId,
      taskType: params.taskType,
      capabilities: JSON.stringify(params.capabilities),
      expectedCost: params.expectedCost,
      actualCost: params.actualCost,
      expectedLatencyMs: params.expectedLatencyMs,
      actualLatencyMs: params.actualLatencyMs,
      qaScore: params.qaScore,
      success: params.success,
    },
  });

  const stats = await refreshAgentStats(params.agentId);
  if (!stats) return;
  const { reputation, successRate, avgQuality } = stats;

  await emitEvent(db, {
    taskId: params.taskId,
    actor: "system",
    eventType: "REPUTATION_UPDATED",
    payload: { agentId: params.agentId, reputation, successRate, avgQuality },
  });

  await applyFailureRateGovernance(params.agentId, params.taskId, params.success);
}

// Rolling failure-rate demotion: reset the streak on success, otherwise
// increment it and demote once it crosses the threshold. Reads/writes only
// what's already in the DB - deterministic, no LLM input, same spirit as
// the Circuit Breaker.
async function applyFailureRateGovernance(agentId: string, taskId: string, success: boolean) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) return;

  const outcome = evaluateFailureStreak({ consecutiveFailures: agent.consecutiveFailures ?? 0, status: agent.status, success });

  if (outcome.consecutiveFailures === (agent.consecutiveFailures ?? 0) && !outcome.demote) {
    return; // nothing changed (e.g. success with an already-zero streak)
  }

  await db.agent.update({
    where: { id: agentId },
    data: outcome.demote ? { consecutiveFailures: outcome.consecutiveFailures, status: "INACTIVE" } : { consecutiveFailures: outcome.consecutiveFailures },
  });

  if (outcome.demote) {
    const consecutiveFailures = outcome.consecutiveFailures;
    await db.securityEvent.create({
      data: {
        taskId,
        agentId,
        type: "AGENT_AUTO_DEMOTED",
        reason: `${consecutiveFailures} consecutive failed attempts`,
        payload: JSON.stringify({ consecutiveFailures, previousStatus: "ACTIVE", newStatus: "INACTIVE" }),
        severity: "MEDIUM",
      },
    });
    await emitEvent(db, {
      taskId,
      actor: "system",
      eventType: "AGENT_AUTO_DEMOTED",
      payload: { agentId, consecutiveFailures, reason: "rolling failure-rate threshold exceeded" },
    });
  }
}
