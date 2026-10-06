import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { recordPerformanceAndUpdateReputation } from "@/lib/economy/reputation";
import { capabilitySpec } from "@/lib/capabilities/catalog";
import { findReport, isBlocking } from "@/lib/capabilities/review";
import type { ReviewIssue } from "@/lib/capabilities/types";
import { loadUpstream, parseArtifacts, taskSources, toUpstreamItem } from "@/lib/manager/workflowContext";

// Review-driven rework. After the final review, blocking issues are routed
// to the workflow step that must fix them; that step's agent revises its
// work with the reviewer's findings, every step downstream of it is re-run on
// the revised material, and the review runs again - at most
// MAX_REWORK_ROUNDS times. Revisions are part of the original contract: the
// agent was already paid on passing its own QA, so no escrow moves here, but
// every revision is QA'd and recorded in the agent's performance history.

export const MAX_REWORK_ROUNDS = 2;

type Row = {
  id: string;
  taskId: string;
  sequence: number;
  type: string;
  requiredCapability: string;
  description: string | null;
  output: string | null;
  artifacts?: string | null;
  dependsOn: string;
  assignedAgentId: string | null;
  attemptCount: number;
  qaScore: number | null;
};

export interface ReworkOutcome {
  cancelled?: boolean;
  approved: boolean;
  score: number;
  rounds: number;
  unresolved: ReviewIssue[];
}

const isVerify = (r: Row) => capabilitySpec(r.requiredCapability)?.stage === "verify";

// Transitive dependents of `ids` among `rows`, in sequence order.
export function downstreamOf(ids: Set<string>, rows: Array<Pick<Row, "id" | "sequence" | "dependsOn">>): string[] {
  const affected = new Set(ids);
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence);
  const out: string[] = [];
  for (const r of ordered) {
    if (affected.has(r.id)) continue;
    const deps = JSON.parse(r.dependsOn) as string[];
    if (deps.some((d) => affected.has(d))) {
      affected.add(r.id);
      out.push(r.id);
    }
  }
  return out;
}

async function revise(params: {
  row: Row;
  feedback: string;
  round: number;
  qualityThreshold: number;
  taskPrompt: string;
  alwaysKeep?: boolean;
}): Promise<{ accepted: boolean; score: number }> {
  const { row, round } = params;
  const agentId = row.assignedAgentId;
  if (!agentId) return { accepted: false, score: row.qaScore ?? 0 };

  const attempt = row.attemptCount + 1;
  await db.subtask.update({ where: { id: row.id }, data: { status: "EXECUTING", attemptCount: attempt } });
  await emitEvent(db, {
    taskId: row.taskId,
    actor: agentId,
    eventType: "WORK_STARTED",
    payload: { subtaskId: row.id, attempt, revision: round, feedback: params.feedback, paid: false, note: "revision within the original contract" },
  });

  const upstream = await loadUpstream(row);
  const knownSources = await taskSources(row.taskId);
  const start = Date.now();
  let exec: Awaited<ReturnType<typeof executeSubtask>>;
  try {
    exec = await executeSubtask({
      type: row.requiredCapability,
      description: row.description ?? row.type,
      taskPrompt: params.taskPrompt,
      feedback: params.feedback,
      upstream,
      knownSources,
      taskId: row.taskId,
      agentId,
      subtaskId: row.id,
    });
  } catch (err) {
    exec = { output: `[EXECUTION ERROR] ${err instanceof Error ? err.message : "unknown error"}`, actualLatencyMs: Date.now() - start, source: "error" };
  }

  await emitEvent(db, {
    taskId: row.taskId,
    actor: agentId,
    eventType: "WORK_COMPLETED",
    payload: { subtaskId: row.id, attempt, revision: round, preview: exec.output.slice(0, 140), source: exec.source },
  });
  await emitEvent(db, { taskId: row.taskId, actor: "qa", eventType: "QA_STARTED", payload: { subtaskId: row.id, attempt, revision: round } });

  const qa = await verifySubtaskOutput({
    type: row.requiredCapability,
    description: row.description ?? row.type,
    output: exec.output,
    qualityThreshold: params.qualityThreshold,
    artifacts: exec.artifacts,
    knownSources: [...knownSources, ...(exec.artifacts?.sources ?? [])],
  });

  await recordPerformanceAndUpdateReputation({
    agentId,
    taskId: row.taskId,
    subtaskId: row.id,
    taskType: row.type,
    capabilities: [row.requiredCapability],
    expectedCost: 0,
    actualCost: 0,
    expectedLatencyMs: exec.actualLatencyMs,
    actualLatencyMs: exec.actualLatencyMs,
    qaScore: qa.verdict.score,
    success: qa.verdict.passed,
  });

  // A revision replaces the previous version only if it passes QA (the
  // previous one did) - or, for the review step, always: a stale review must
  // not keep gating revised work.
  const accepted = qa.verdict.passed || Boolean(params.alwaysKeep);
  await db.subtask.update({
    where: { id: row.id },
    data: accepted
      ? { status: "DONE", output: exec.output, artifacts: exec.artifacts ? JSON.stringify(exec.artifacts) : null, qaScore: qa.verdict.score, qaReason: qa.verdict.reason }
      : { status: "DONE" },
  });
  await emitEvent(db, {
    taskId: row.taskId,
    actor: "qa",
    eventType: qa.verdict.passed ? "QA_PASSED" : "QA_FAILED",
    payload: { subtaskId: row.id, attempt, revision: round, score: qa.verdict.score, reason: qa.verdict.reason, issues: qa.verdict.issues, kept: accepted ? "revision" : "previous version" },
  });
  return { accepted, score: qa.verdict.score };
}

export async function runReworkCycle(params: {
  taskId: string;
  taskPrompt: string;
  qualityThreshold: number;
  reviewSubtaskId: string;
  isCancelled: () => Promise<boolean>;
}): Promise<ReworkOutcome> {
  let rounds = 0;

  for (;;) {
    const rows = (await db.subtask.findMany({ where: { taskId: params.taskId }, orderBy: { sequence: "asc" } })) as Row[];
    const reviewRow = rows.find((r) => r.id === params.reviewSubtaskId);
    const review = parseArtifacts(reviewRow?.artifacts)?.review;
    if (!reviewRow || !review) return { approved: false, score: reviewRow?.qaScore ?? 0, rounds, unresolved: [] };

    const blocking = review.issues.filter(isBlocking);
    await emitEvent(db, {
      taskId: params.taskId,
      actor: reviewRow.assignedAgentId ?? "qa",
      eventType: "INTEGRATION_REVIEW_COMPLETED",
      payload: { subtaskId: reviewRow.id, round: rounds, approved: review.approved && blocking.length === 0, score: review.score, summary: review.summary, issues: review.issues },
    });

    if (blocking.length === 0) return { approved: true, score: review.score, rounds, unresolved: [] };
    if (rounds >= MAX_REWORK_ROUNDS) {
      await emitEvent(db, {
        taskId: params.taskId,
        actor: "manager",
        eventType: "REWORK_COMPLETED",
        payload: { rounds, resolved: false, unresolved: blocking },
      });
      return { approved: false, score: review.score, rounds, unresolved: blocking };
    }
    if (await params.isCancelled()) return { cancelled: true, approved: false, score: review.score, rounds, unresolved: blocking };
    rounds += 1;

    // Route each blocking issue to its step (unattributed -> the deliverable).
    const content = rows.filter((r) => !isVerify(r) && r.output);
    const deliverable = findReport(content.map(toUpstreamItem));
    const targets = new Map<string, ReviewIssue[]>();
    for (const issue of blocking) {
      const row = content.find((r) => r.sequence === issue.targetSequence) ?? content.find((r) => r.id === deliverable?.subtaskId);
      if (!row) continue;
      targets.set(row.id, [...(targets.get(row.id) ?? []), issue]);
    }
    const targetRows = content.filter((r) => targets.has(r.id));
    const dependents = downstreamOf(new Set(targets.keys()), content).map((id) => content.find((r) => r.id === id)!);

    await emitEvent(db, {
      taskId: params.taskId,
      actor: "manager",
      eventType: "REWORK_REQUESTED",
      payload: {
        round: rounds,
        targets: targetRows.map((r) => ({ subtaskId: r.id, type: r.type, agentId: r.assignedAgentId, issues: targets.get(r.id)!.map((i) => i.description) })),
        rerun: dependents.map((r) => ({ subtaskId: r.id, type: r.type })),
      },
    });

    for (const row of targetRows) {
      if (await params.isCancelled()) return { cancelled: true, approved: false, score: review.score, rounds, unresolved: blocking };
      const issues = targets.get(row.id)!;
      await revise({
        row,
        round: rounds,
        qualityThreshold: params.qualityThreshold,
        taskPrompt: params.taskPrompt,
        feedback: `The final review sent this work back. Fix: ${issues.map((i) => `${i.description} -> ${i.fix}`).join(" | ")}`,
      });
    }
    for (const row of dependents) {
      if (await params.isCancelled()) return { cancelled: true, approved: false, score: review.score, rounds, unresolved: blocking };
      const fresh = (await db.subtask.findUnique({ where: { id: row.id } })) as Row;
      await revise({
        row: fresh,
        round: rounds,
        qualityThreshold: params.qualityThreshold,
        taskPrompt: params.taskPrompt,
        feedback: `Upstream work you depend on was revised (${targetRows.map((t) => t.type).join(", ")}) to fix: ${blocking.map((i) => i.description).join(" | ")}. Update your output to reflect the revised material and resolve these issues.`,
      });
    }

    if (await params.isCancelled()) return { cancelled: true, approved: false, score: review.score, rounds, unresolved: blocking };
    const freshReview = (await db.subtask.findUnique({ where: { id: reviewRow.id } })) as Row;
    await revise({
      row: freshReview,
      round: rounds,
      qualityThreshold: params.qualityThreshold,
      taskPrompt: params.taskPrompt,
      feedback: `Re-review after rework round ${rounds}. Previously blocking: ${blocking.map((i) => i.description).join(" | ")}. Check whether each was fixed and look for anything new.`,
      alwaysKeep: true,
    });
  }
}
