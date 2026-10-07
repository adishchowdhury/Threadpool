import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { recordPerformanceAndUpdateReputation } from "@/lib/economy/reputation";
import { capabilitySpec } from "@/lib/capabilities/catalog";
import { findReport, isBlocking } from "@/lib/capabilities/review";
import type { ReviewIssue } from "@/lib/capabilities/types";
import { loadUpstream, parseArtifacts, taskSources, toUpstreamItem } from "@/lib/manager/workflowContext";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { deadlineExhausted, runWithBudget } from "@/lib/runtime/deadline";
import { ATTEMPT_EXEC_BUDGET_MS, QA_BUDGET_MS } from "@/lib/manager/budgets";

// Review-driven rework. After the final review, blocking issues are routed
// to the workflow step that must fix them; that step's agent revises its
// work with the reviewer's findings, every step downstream of it is re-run on
// the revised material, and the review runs again - at most
// MAX_REWORK_ROUNDS times. Revisions are part of the original contract: the
// agent was already paid on passing its own QA, so no escrow moves here, but
// every revision is QA'd and recorded in the agent's performance history.

// One round: each round re-runs the flagged step, everything downstream of
// it and the review itself - several full worker+QA cycles - and a second
// round rarely changed the outcome while roughly doubling task time.
export const MAX_REWORK_ROUNDS = 1;

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
  // Ran out of segment time mid-round; resume with the saved progress.
  interrupted?: boolean;
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
}): Promise<{ accepted: boolean; score: number; abandoned?: boolean }> {
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
    exec = await runWithBudget(ATTEMPT_EXEC_BUDGET_MS, () =>
      executeSubtask({
        type: row.requiredCapability,
        description: row.description ?? row.type,
        taskPrompt: params.taskPrompt,
        feedback: params.feedback,
        upstream,
        knownSources,
        taskId: row.taskId,
        agentId,
        subtaskId: row.id,
      }),
    );
  } catch (err) {
    exec = { output: `[EXECUTION ERROR] ${err instanceof Error ? err.message : "unknown error"}`, actualLatencyMs: Date.now() - start, source: "error" };
  }

  // A revision the segment deadline may have cut short is discarded: the
  // previous accepted version stays, and nobody is scored for it.
  if (deadlineExhausted()) return abandonRevision(row);

  await emitEvent(db, {
    taskId: row.taskId,
    actor: agentId,
    eventType: "WORK_COMPLETED",
    payload: { subtaskId: row.id, attempt, revision: round, preview: exec.output.slice(0, 140), source: exec.source },
  });
  await emitEvent(db, { taskId: row.taskId, actor: "qa", eventType: "QA_STARTED", payload: { subtaskId: row.id, attempt, revision: round } });

  const qa = await runWithBudget(QA_BUDGET_MS, () =>
    verifySubtaskOutput({
      type: row.requiredCapability,
      description: row.description ?? row.type,
      output: exec.output,
      qualityThreshold: params.qualityThreshold,
      artifacts: exec.artifacts,
      knownSources: [...knownSources, ...(exec.artifacts?.sources ?? [])],
    }),
  );
  if (deadlineExhausted()) return abandonRevision(row);

  // Provider outages aren't the agent's work - see orchestrator.isInfraFailure.
  const infraFailure = exec.source === "error" || (exec.source === "local_fallback" && isSarvamConfigured());
  if (!infraFailure) {
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
  }

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

async function abandonRevision(row: Row): Promise<{ accepted: boolean; score: number; abandoned: boolean }> {
  await db.subtask.update({ where: { id: row.id }, data: { status: "DONE", attemptCount: row.attemptCount } });
  return { accepted: false, score: row.qaScore ?? 0, abandoned: true };
}

// Which steps of the current rework round have already been revised. Saved
// after every revision so a round spread over several execution segments
// resumes where it stopped instead of revising the same steps again.
export interface ReworkProgress {
  completedRounds: number;
  revised: string[];
}

export async function runReworkCycle(params: {
  taskId: string;
  taskPrompt: string;
  qualityThreshold: number;
  reviewSubtaskId: string;
  isCancelled: () => Promise<boolean>;
  // False once the current segment has no time for another revision; the
  // cycle then returns `interrupted` and is resumed from `progress` later.
  canContinue?: () => boolean;
  progress?: ReworkProgress | null;
  saveProgress?: (progress: ReworkProgress) => Promise<unknown>;
}): Promise<ReworkOutcome> {
  const canContinue = params.canContinue ?? (() => true);
  const saveProgress = params.saveProgress ?? (async () => {});
  let rounds = params.progress?.completedRounds ?? 0;
  const revised = new Set(params.progress?.revised ?? []);

  for (;;) {
    const rows = (await db.subtask.findMany({ where: { taskId: params.taskId }, orderBy: { sequence: "asc" } })) as Row[];
    const reviewRow = rows.find((r) => r.id === params.reviewSubtaskId);
    const review = parseArtifacts(reviewRow?.artifacts)?.review;
    if (!reviewRow || !review) return { approved: false, score: reviewRow?.qaScore ?? 0, rounds, unresolved: [] };

    const blocking = review.issues.filter(isBlocking);
    const roundInProgress = revised.size > 0;
    const cancelled = { cancelled: true, approved: false, score: review.score, rounds, unresolved: blocking };
    const interrupted = { interrupted: true, approved: false, score: review.score, rounds, unresolved: blocking };

    if (!roundInProgress) {
      await emitEvent(db, {
        taskId: params.taskId,
        actor: reviewRow.assignedAgentId ?? "qa",
        eventType: "INTEGRATION_REVIEW_COMPLETED",
        payload: { subtaskId: reviewRow.id, round: rounds, approved: review.approved && blocking.length === 0, score: review.score, summary: review.summary, issues: review.issues },
      });
      if (blocking.length === 0) return { approved: true, score: review.score, rounds, unresolved: [] };
      if (rounds >= MAX_REWORK_ROUNDS) {
        await emitEvent(db, { taskId: params.taskId, actor: "manager", eventType: "REWORK_COMPLETED", payload: { rounds, resolved: false, unresolved: blocking } });
        return { approved: false, score: review.score, rounds, unresolved: blocking };
      }
    }
    if (await params.isCancelled()) return cancelled;
    if (!canContinue()) return interrupted;

    // Route each blocking issue to its step (unattributed -> the deliverable).
    // Deterministic for a given review, so a resumed round recomputes the
    // same plan.
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
    const round = rounds + 1;

    if (!roundInProgress) {
      await emitEvent(db, {
        taskId: params.taskId,
        actor: "manager",
        eventType: "REWORK_REQUESTED",
        payload: {
          round,
          targets: targetRows.map((r) => ({ subtaskId: r.id, type: r.type, agentId: r.assignedAgentId, issues: targets.get(r.id)!.map((i) => i.description) })),
          rerun: dependents.map((r) => ({ subtaskId: r.id, type: r.type })),
        },
      });
    }

    const steps: Array<{ id: string; feedback: string; alwaysKeep?: boolean }> = [
      ...targetRows.map((r) => ({
        id: r.id,
        feedback: `The final review sent this work back. Fix: ${targets.get(r.id)!.map((i) => `${i.description} -> ${i.fix}`).join(" | ")}`,
      })),
      ...dependents.map((r) => ({
        id: r.id,
        feedback: `Upstream work you depend on was revised (${targetRows.map((t) => t.type).join(", ")}) to fix: ${blocking.map((i) => i.description).join(" | ")}. Update your output to reflect the revised material and resolve these issues.`,
      })),
      {
        id: reviewRow.id,
        feedback: `Re-review after rework round ${round}. Previously blocking: ${blocking.map((i) => i.description).join(" | ")}. Check whether each was fixed and look for anything new.`,
        alwaysKeep: true,
      },
    ];

    for (const step of steps) {
      if (revised.has(step.id)) continue;
      if (await params.isCancelled()) return cancelled;
      if (!canContinue()) return interrupted;
      const fresh = (await db.subtask.findUnique({ where: { id: step.id } })) as Row;
      const result = await revise({ row: fresh, round, qualityThreshold: params.qualityThreshold, taskPrompt: params.taskPrompt, feedback: step.feedback, alwaysKeep: step.alwaysKeep });
      // Cut short by the deadline: not done - it is redone when resumed.
      if (result.abandoned) return interrupted;
      revised.add(step.id);
      await saveProgress({ completedRounds: rounds, revised: [...revised] });
    }

    rounds = round;
    revised.clear();
    await saveProgress({ completedRounds: rounds, revised: [] });
  }
}
