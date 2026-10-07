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
  const taskRow = await db.task.findUnique({ where: { id: params.taskId } });
  await db.agentPerformance.create({
    data: {
      domain: taskRow?.domain ?? "general",
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

// Demotion is meant to be reversible, but nothing used to reverse it:
// discovery only sees ACTIVE agents, so a demoted agent could never earn its
// way back, and once every agent for a capability was demoted (which a
// provider timeout bug did to whole capabilities) every task needing it
// failed with "capability match 0". Two deterministic rules, run before
// discovery for a capability, restore it:
//   1. cooldown - a built-in agent demoted more than REINSTATE_COOLDOWN_MS
//      ago (or before demotedAt existed) goes back on probation (streak
//      reset; three more failures demote it again);
//   2. never empty - if a capability still has no ACTIVE agent, the best-
//      rated demoted one is reinstated rather than skipping the step.
// External agents are excluded: their reinstatement is driven by a passing
// health check (app/api/agents/health/sweep). REVOKED (severe Circuit
// Breaker violation) is permanent and never touched here.
export const REINSTATE_COOLDOWN_MS = 30 * 60_000;

export async function reinstateForCapability(capability: string, taskId: string | null): Promise<string[]> {
  const all = await db.agent.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] }, isExternal: { not: true } } });
  const matching = all.filter((a) => (JSON.parse(a.capabilities) as string[]).includes(capability));
  const inactive = matching.filter((a) => a.status === "INACTIVE");
  if (inactive.length === 0) return [];

  const now = Date.now();
  const toReinstate = inactive.filter((a) => !a.demotedAt || now - new Date(a.demotedAt).getTime() >= REINSTATE_COOLDOWN_MS);
  const activeAfter = matching.filter((a) => a.status === "ACTIVE").length + toReinstate.length;
  if (activeAfter === 0) {
    const best = [...inactive].sort((a, b) => (b.reputation ?? 0) - (a.reputation ?? 0))[0];
    toReinstate.push(best);
  }

  for (const agent of toReinstate) {
    // Conditional on still being INACTIVE: two concurrent subtasks may run
    // this for the same capability; only one write should win.
    const claimed = await db.agent.updateMany({ where: { id: agent.id, status: "INACTIVE" }, data: { status: "ACTIVE", consecutiveFailures: 0, demotedAt: null } });
    if (claimed.count === 0) continue;
    await emitEvent(db, {
      taskId,
      actor: "system",
      eventType: "AGENT_REACTIVATED",
      payload: { agentId: agent.id, name: agent.name, capability, reason: activeAfter === 0 ? "no active agent left for this capability" : "demotion cooldown elapsed" },
    });
  }
  return toReinstate.map((a) => a.id);
}

// Applies reinstateForCapability to every capability that currently has a
// demoted built-in agent - run before a task is priced and planned, so a
// capability isn't planned around as unstaffable just because its agents
// are serving out a demotion.
export async function reinstateEligibleAgents(taskId: string | null): Promise<void> {
  const inactive = await db.agent.findMany({ where: { status: "INACTIVE", isExternal: { not: true } } });
  const capabilities = new Set(inactive.flatMap((a) => JSON.parse(a.capabilities) as string[]));
  for (const capability of capabilities) await reinstateForCapability(capability, taskId);
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
    data: outcome.demote
      ? { consecutiveFailures: outcome.consecutiveFailures, status: "INACTIVE", demotedAt: new Date() }
      : { consecutiveFailures: outcome.consecutiveFailures },
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
