import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { commitWorkflowEvent, verifyWorkflowEvent, computeSha256 } from "@/lib/blockchain/algorandTrust";
import { decomposeTask, fitPlanToBudget, workflowSignature } from "@/lib/manager/planner";
import { priceFloorByCapability, reserveForLaterSteps, loadUpstream, taskSources, parseArtifacts } from "@/lib/manager/workflowContext";
import { runReworkCycle, type ReworkOutcome, type ReworkProgress } from "@/lib/manager/rework";
import { hashText } from "@/lib/capabilities/review";
import { renderSourcesSection, sourcesForText, stripInvalidCitations, stripModelSourceList } from "@/lib/capabilities/sources";
import { discoverAgents } from "@/lib/discovery";
import { findContradictions, describeContradiction } from "@/lib/manager/contradictions";
import type { DataSensitivity } from "@/lib/discovery/access";
import { buildTaskContract, evaluateContract, type TaskContract } from "@/lib/manager/contract";
import { filterCandidatesStaged } from "@/lib/manager/filter";
import { collectBids } from "@/lib/manager/bidding";
import { rankCandidates } from "@/lib/manager/rank";
import { lockAgentEscrow, releaseAgentEscrow, refundAgentEscrow } from "@/lib/economy/escrow";
import { issueCredential, CREDENTIAL_OPERATIONS } from "@/lib/economy/credentials";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import type { QaVerdict } from "@/lib/manager/schemas";
import { checkReportNumbers } from "@/lib/manager/numericCheck";
import { computeOverallConfidence } from "@/lib/manager/confidence";
import { buildFinalReport } from "@/lib/manager/finalReport";
import { recordPerformanceAndUpdateReputation, reinstateEligibleAgents, reinstateForCapability } from "@/lib/economy/reputation";
import { findSimilarWorkflow, storeWorkflow } from "@/lib/manager/workflowMemory";
import { describeIncompleteStep, renderLimitationsNote, type SkipKind } from "@/lib/manager/incompleteSteps";
import { deadlineExhausted, remainingMs, runWithBudget } from "@/lib/runtime/deadline";
import { ATTEMPT_EXEC_BUDGET_MS, ATTEMPT_START_WINDOW_MS, ATTEMPT_WINDOW_MS, QA_BUDGET_MS } from "@/lib/manager/budgets";

// Max times one subtask's escrow may be moved to a different agent after the
// current one fails.
const MAX_REASSIGNMENTS = 3;

// A task runs as a chain of bounded segments (lib/manager/taskRunner.ts),
// one serverless invocation each; the remaining time of the current segment
// comes from lib/runtime/deadline.ts. A unit of work only starts if the
// segment can realistically finish it - otherwise the segment yields and the
// next one picks up from the persisted state. Outside a segment (scripts)
// there is no deadline and the task runs to completion in one go.
const FINAL_PHASE_WINDOW_MS = 60_000;
const hasWindow = (ms: number) => remainingMs() >= ms;

const IN_FLIGHT_SUBTASK_STATUSES = ["BIDDING", "ASSIGNED", "EXECUTING", "AWAITING_QA"];
const OUT_OF_TIME_REASON = "the workflow ran out of execution time before this step could finish";

export type SegmentOutcome = { status: "finished" } | { status: "stopped" } | { status: "yielded"; reason: string };
const FINISHED: SegmentOutcome = { status: "finished" };
const STOPPED: SegmentOutcome = { status: "stopped" };

async function isCancelled(taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  return task.status === "CANCELLED" || task.status === "CANCELLING";
}

export async function failTask(taskId: string, reason: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.status === "CANCELLED" || task.status === "CANCELLING" || task.status === "COMPLETED" || task.status === "PARTIAL") return;

  // A failed task must not leave money locked: return every outstanding
  // escrow to the task budget (each refund goes through the escrow service,
  // the Circuit Breaker and the ledger like any other mutation).
  const locked = await db.agentEscrow.findMany({ where: { taskId, status: "LOCKED" } });
  for (const escrow of locked) {
    await refundAgentEscrow({ agentEscrowId: escrow.id, reason: "task_failed" });
  }

  await db.task.update({
    where: { id: taskId },
    data: {
      status: "FAILED",
      finalOutput: JSON.stringify({
        content: null,
        failure_reason: reason,
      }),
    },
  });
  await emitEvent(db, { taskId, actor: "manager", eventType: "TASK_FAILED", payload: { reason } });
}

// A provider outage or timeout is not the agent's work: it must not count
// against the agent's performance record or failure streak. Counting it is
// what auto-demoted whole capabilities' worth of agents when Sarvam calls
// were timing out, leaving later tasks with nobody to hire.
function isInfraFailure(source: string): boolean {
  return source === "error" || (source === "local_fallback" && isSarvamConfigured());
}

async function markSkipped(taskId: string, subtask: { id: string; type: string }, kind: SkipKind, reason: string, extra: Record<string, unknown> = {}) {
  await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED", skipReason: reason, skipKind: kind, ...extra } });
  await emitEvent(db, { taskId, actor: "manager", eventType: "SUBTASK_SKIPPED", payload: { subtaskId: subtask.id, type: subtask.type, reason } });
}

// Group subtasks into dependency levels (topological batches): everything in
// a level has every dependency satisfied by an earlier level, so it runs
// concurrently with the rest of its level. `sequence` is a strict total
// order assigned at plan time, but `dependsOn` is the real DAG.
function buildLevels<T extends { id: string; dependsOn: string }>(subtasks: T[]): T[][] {
  const levelOf = new Map<string, number>();
  for (const s of subtasks) {
    const deps = JSON.parse(s.dependsOn) as string[];
    // Safe to look up now: dependsOnSequence only ever points at earlier
    // sequence numbers (planner.ts), and `subtasks` is sorted by sequence.
    const level = deps.length === 0 ? 0 : Math.max(...deps.map((d) => levelOf.get(d) ?? 0)) + 1;
    levelOf.set(s.id, level);
  }
  const levels: T[][] = [];
  for (const s of subtasks) (levels[levelOf.get(s.id)!] ??= []).push(s);
  return levels.filter(Boolean);
}

function parseIdList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function planTask(task: { id: string; prompt: string; budget: number; qualityThreshold: number; deadline?: Date | null; dataSensitivity?: DataSensitivity }, floor: Map<string, number>) {
  const taskId = task.id;
  // A segment killed mid-planning can leave a partial plan behind. Nothing
  // has been hired or paid for at this stage, so it is safe to start over.
  await db.subtask.deleteMany({ where: { taskId } });
  await db.task.update({ where: { id: taskId }, data: { status: "PLANNING" } });
  await emitEvent(db, { taskId, actor: "manager", eventType: "MANAGER_PLANNING", payload: { prompt: task.prompt } });

  const decomposed = await decomposeTask({ prompt: task.prompt, budget: task.budget, qualityThreshold: task.qualityThreshold });
  const planSource = decomposed.source;
  if (await isCancelled(taskId)) return;

  // Fit the proposed workflow to what the market can actually staff within
  // the budget (cheapest hireable price per capability).
  const fitted = fitPlanToBudget(decomposed.plan, floor, task.budget);
  const plan = fitted.plan;
  if (decomposed.adjustments.length > 0 || fitted.dropped.length > 0) {
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "PLAN_ADJUSTED",
      payload: { planSource, normalization: decomposed.adjustments, dropped: fitted.dropped, estimatedMinCost: fitted.estimatedMinCost },
    });
  }

  const memory = await findSimilarWorkflow(workflowSignature(plan), task.prompt);
  if (memory) {
    await emitEvent(db, {
      taskId,
      actor: "system",
      eventType: "WORKFLOW_MEMORY_STORED", // reused as "recalled" signal for the UI timeline
      payload: {
        recalled: true,
        similarity: memory.similarity,
        agentsUsed: JSON.parse(memory.memory.agentsUsed),
        historicalCost: memory.memory.cost,
        historicalLatencyMs: memory.memory.latencyMs,
        historicalQuality: memory.memory.quality,
      },
    });
  }

  // Create subtask rows, mapping the plan's sequence numbers to real ids
  // so dependsOn can be stored as actual subtask ids.
  const seqToId = new Map<number, string>();
  for (const sp of [...plan.subtasks].sort((a, b) => a.sequence - b.sequence)) {
    const row = await db.subtask.create({
      data: {
        taskId,
        type: sp.type,
        requiredCapability: sp.requiredCapability,
        description: sp.description,
        sequence: sp.sequence,
        dependsOn: JSON.stringify(sp.dependsOnSequence.map((s) => seqToId.get(s)).filter(Boolean)),
      },
    });
    seqToId.set(sp.sequence, row.id);
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "SUBTASK_CREATED",
      payload: { subtaskId: row.id, type: sp.type, requiredCapability: sp.requiredCapability, sequence: sp.sequence, dependsOnSequence: sp.dependsOnSequence, planSource },
    });
  }

  if (await isCancelled(taskId)) return;

  // Fix what "success" means before anything is hired; evaluated at completion.
  const contract = buildTaskContract({
    objective: plan.summary,
    subtasks: plan.subtasks,
    qualityThreshold: task.qualityThreshold,
    budget: task.budget,
    deadline: task.deadline ?? null,
    dataSensitivity: task.dataSensitivity ?? "PUBLIC",
  });
  await db.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS", contract: JSON.stringify(contract) } });
  await emitEvent(db, { taskId, actor: "manager", eventType: "CONTRACT_CREATED", payload: contract });
}

// A previous segment that was killed (or crashed) mid-subtask leaves escrow
// LOCKED and subtasks in an in-flight status that nothing will ever move.
// Settle them deterministically before continuing: escrow for work that
// already passed QA is paid out, everything else is refunded to the task
// budget, and unfinished subtasks go back to PENDING to be re-run.
async function recoverInterruptedWork(taskId: string) {
  const rows = await db.subtask.findMany({ where: { taskId } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const escrows = await db.agentEscrow.findMany({ where: { taskId } });

  for (const escrow of escrows.filter((e) => e.status === "LOCKED")) {
    const subtask = byId.get(escrow.subtaskId);
    // A refused payout (e.g. its scoped credential expired) falls back to a
    // refund: funds are never left locked.
    const paid =
      subtask?.status === "DONE" &&
      !(await releaseAgentEscrow({ agentEscrowId: escrow.id, requestedAmount: escrow.amount, purpose: subtask.requiredCapability })).blocked;
    if (!paid) await refundAgentEscrow({ agentEscrowId: escrow.id, reason: "segment_interrupted" });
  }

  for (const row of rows.filter((r) => IN_FLIGHT_SUBTASK_STATUSES.includes(r.status))) {
    // Already paid = it had passed QA earlier and was being revised by the
    // final review's rework loop; its accepted output is intact.
    const paid = escrows.some((e) => e.subtaskId === row.id && e.status === "RELEASED");
    await db.subtask.update({ where: { id: row.id }, data: paid ? { status: "DONE" } : { status: "PENDING", assignedAgentId: null } });
  }
}

// Runs one segment of a task: plans it (first segment only), then works
// through the dependency levels, the final review's rework and the report,
// stopping early with "yielded" when the segment cannot fit the next unit of
// work. Safe to call repeatedly - everything it needs is read from the DB.
export async function runTask(taskId: string, opts: { finalSegment?: boolean } = {}): Promise<SegmentOutcome> {
  const finalSegment = opts.finalSegment ?? false;
  const initial = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (await isCancelled(taskId)) return STOPPED;

  // Before pricing the plan: demoted agents whose cooldown has passed (or
  // whose capability has nobody left) get another chance.
  await reinstateEligibleAgents(taskId);
  const floor = await priceFloorByCapability();

  if (initial.status === "CREATED" || initial.status === "PLANNING") {
    await planTask(initial, floor);
    if (await isCancelled(taskId)) return STOPPED;
  } else {
    await recoverInterruptedWork(taskId);
  }

  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const subtasks: any[] = await db.subtask.findMany({ where: { taskId }, orderBy: { sequence: "asc" } });
  const unfinished = (s: { status: string }) => s.status !== "DONE" && s.status !== "FAILED";

  // Set by any subtask that can't fit in this segment; checked between
  // levels. An object, not a `let`, so TS doesn't narrow it to its initial
  // null across the concurrent processSubtask calls.
  const yieldState: { reason: string | null } = { reason: null };
  const requestYield = (reason: string) => {
    yieldState.reason ??= reason;
  };

  // Runs one subtask end-to-end: discovery -> filtering -> ranking -> escrow
  // -> execution -> QA -> retry/reassignment -> payout. A subtask only starts
  // once every subtask it `dependsOn` has finished (levels), so
  // `loadUpstream` sees complete upstream output.
  //
  // A `return` in here only ends THIS subtask's processing: fatal paths call
  // failTask() first (checked between levels), time-outs call requestYield().
  async function processSubtask(subtask: any): Promise<void> {
    if (await isCancelled(taskId)) return;

    // Includes room for hiring (discovery, bids, escrow lock), so the first
    // attempt below doesn't immediately fail its own window check.
    if (!hasWindow(ATTEMPT_START_WINDOW_MS)) {
      if (finalSegment) await markSkipped(taskId, subtask, "time", OUT_OF_TIME_REASON);
      else requestYield(`not enough time left in this segment to start '${subtask.type}'`);
      return;
    }

    const currentTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });

    await db.subtask.update({ where: { id: subtask.id }, data: { status: "BIDDING" } });

    await reinstateForCapability(subtask.requiredCapability, taskId);
    const discovery = await discoverAgents(subtask.requiredCapability, {
      organizationId: currentTask.organizationId ?? null,
      dataSensitivity: currentTask.dataSensitivity ?? "PUBLIC",
      approvedAgentIds: parseIdList(currentTask.approvedAgentIds),
    });
    const discovered = discovery.agents;
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_DISCOVERED",
      payload: {
        subtaskId: subtask.id,
        count: discovered.length,
        matched: discovery.matched,
        excluded: discovery.excluded,
        dataSensitivity: currentTask.dataSensitivity ?? "PUBLIC",
        approvedAgents: parseIdList(currentTask.approvedAgentIds).length,
        agentIds: discovered.map((a) => a.id),
      },
    });

    // Hold back enough budget to staff every later, still-unfinished step at
    // the market floor.
    const reserve = reserveForLaterSteps(subtasks.filter(unfinished), subtask.sequence, floor);
    const spendCap = Math.max(0, currentTask.remainingBudget - reserve);
    const { eligible: filtered, stages: poolStages } = filterCandidatesStaged(discovered, currentTask.remainingBudget, currentTask.qualityThreshold, spendCap);
    // The pool above is already access-controlled; show the funnel from the
    // true capability-match count through the tenant/data-sensitivity gate.
    const stages = [
      { stage: "capability match", count: discovery.matched },
      { stage: "tenant & data access", count: discovered.length },
      ...poolStages.slice(1),
    ];
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_FILTERED",
      payload: { subtaskId: subtask.id, count: filtered.length, stages, agentIds: filtered.map((a) => a.id), reserve, spendCap },
    });

    if (filtered.length === 0) {
      await markSkipped(taskId, subtask, "no_agent", `No eligible agent available for subtask '${subtask.type}' within remaining budget.`);
      return;
    }

    const bids = await collectBids({ taskId, subtaskId: subtask.id, candidates: filtered });
    const ranked = await rankCandidates({
      candidates: filtered,
      bids,
      requiredCapability: subtask.requiredCapability,
      taskType: subtask.type,
      qualityThreshold: currentTask.qualityThreshold,
      domain: currentTask.domain,
    });

    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_RANKED",
      payload: { subtaskId: subtask.id, ranking: ranked.map((r) => ({ agentId: r.agent.id, score: r.totalScore })) },
    });

    // `active` tracks whichever agent currently holds the escrow for this
    // subtask - it can change mid-loop via reassignment (§8.2 path B).
    // Agents that already failed QA on this step - possibly in an earlier
    // segment, so the in-memory set below can't know - aren't re-hired while
    // an untried one exists. The performance record survives a hand-off.
    const failedHere = new Set(
      (await db.agentPerformance.findMany({ where: { subtaskId: subtask.id, success: false } })).map((p: { agentId: string }) => p.agentId),
    );
    let active = ranked.find((r) => !failedHere.has(r.agent.id)) ?? ranked[0];
    let activeEscrowId: string;
    const triedAgentIds = new Set<string>(failedHere);
    let reassignments = 0;

    // Best untried replacement, ranked on current data after the failed
    // agent's reputation/performance were recorded and its escrow refunded.
    async function pickReplacement() {
      const fresh = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const remaining = ranked.filter((r) => !triedAgentIds.has(r.agent.id) && r.bidAmount <= fresh.remainingBudget);
      if (remaining.length === 0) return undefined;
      const activeIds = new Set(
        (await db.agent.findMany({ where: { id: { in: remaining.map((r) => r.agent.id) }, status: "ACTIVE" } })).map((a) => a.id),
      );
      const candidates = remaining.filter((r) => activeIds.has(r.agent.id));
      if (candidates.length === 0) return undefined;
      const reranked = await rankCandidates({
        candidates: candidates.map((c) => c.agent),
        bids: new Map(candidates.map((c) => [c.agent.id, c.bidAmount])),
        requiredCapability: subtask.requiredCapability,
        taskType: subtask.type,
        domain: currentTask.domain,
      });
      return reranked[0];
    }

    async function assign(candidate: (typeof ranked)[number]) {
      await db.subtask.update({
        where: { id: subtask.id },
        data: { status: "ASSIGNED", assignedAgentId: candidate.agent.id },
      });

      // Anchor task assignment on Algorand trust layer
      await commitWorkflowEvent({
        workflowId: taskId,
        taskId,
        eventType: "TASK_ASSIGNED",
        fromAgentId: "manager",
        toAgentId: candidate.agent.id,
        payload: {
          subtaskId: subtask.id,
          agentId: candidate.agent.id,
          requiredCapability: subtask.requiredCapability,
          budget: candidate.bidAmount,
        },
      });

      await emitEvent(db, {
        taskId,
        actor: "manager",
        eventType: "AGENT_SELECTED",
        payload: { subtaskId: subtask.id, agentId: candidate.agent.id, explanation: candidate.explanation, scoreBreakdown: candidate.scoreBreakdown },
      });

      // Scoped credential (§4): a second, independent authorization layer
      // for exactly this subtask/agent, bounded to the bid amount it was
      // selected at. The Circuit Breaker inside lockAgentEscrow/
      // releaseAgentEscrow still runs unchanged - this is additive, not a
      // replacement.
      const credential = await issueCredential({
        taskId,
        subtaskId: subtask.id,
        agentId: candidate.agent.id,
        allowedOperations: CREDENTIAL_OPERATIONS,
        maxSpend: candidate.bidAmount,
      });

      const lockResult = await lockAgentEscrow({
        taskId,
        subtaskId: subtask.id,
        agentId: candidate.agent.id,
        amount: candidate.bidAmount,
        purpose: subtask.requiredCapability,
        credentialId: credential.id,
      });

      // Close the race between a concurrent cancelTask() refund sweep and
      // this lock: cancelTask() only refunds escrows LOCKED at the instant
      // it runs, so a lock created just after that sweep would otherwise
      // stay LOCKED forever. Re-check right after locking and self-refund.
      if (!lockResult.blocked && (await isCancelled(taskId))) {
        await refundAgentEscrow({ agentEscrowId: lockResult.agentEscrow.id, reason: "task_cancelled" });
        return { blocked: true as const, reason: "task cancelled during escrow lock", revoked: false };
      }

      return lockResult;
    }

    // Stops this subtask because the segment is out of time. Mid-task it
    // hands the step to the next segment untouched (escrow refunded, the
    // interrupted attempt not counted, nobody scored); in the last allowed
    // segment it is soft-skipped instead so the task can still finish.
    async function stopForTime(attemptCountToKeep: number) {
      await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: finalSegment ? "out_of_time" : "segment_handoff" });
      if (finalSegment) {
        await markSkipped(taskId, subtask, "time", OUT_OF_TIME_REASON, { output: null, attemptCount: attemptCountToKeep });
      } else {
        await db.subtask.update({ where: { id: subtask.id }, data: { status: "PENDING", assignedAgentId: null, attemptCount: attemptCountToKeep } });
        requestYield(`'${subtask.type}' did not fit in this segment`);
      }
    }

    // A blocked lock moves no money (fail closed) and is recorded by the
    // Circuit Breaker as a security event; it skips this step instead of
    // failing the whole task - e.g. the chosen agent was demoted by a
    // parallel step between ranking and hiring.
    const firstLock = await assign(active);
    if (firstLock.blocked) {
      if (await isCancelled(taskId)) return;
      await markSkipped(taskId, subtask, "safeguard", `escrow lock blocked by the Circuit Breaker: ${firstLock.reason}`);
      return;
    }
    activeEscrowId = firstLock.agentEscrow.id;
    triedAgentIds.add(active.agent.id);

    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "WORKFORCE_CONSTRUCTED",
      payload: { subtaskId: subtask.id, agentId: active.agent.id, amount: active.bidAmount },
    });

    // Results flow between agents: this subtask's worker receives the outputs
    // and structured artifacts (sources, comparables, datasets) of the
    // subtasks it depends on, plus every source retrieved so far in the task
    // for citation.
    const upstream = await loadUpstream(subtask);
    const knownSources = await taskSources(taskId);

    let feedback: string | undefined;
    let done = false;
    let localAttempt = 0; // attempts against the CURRENTLY assigned agent
    let firstAttemptCleared = true;
    const maxAttempts = subtask.maxAttempts;
    // Across segments and reassignments - a hard stop on total attempts (two
    // agents' worth), so a step the QA bar won't accept is disclosed as
    // incomplete instead of consuming many more minutes of attempts.
    const maxTotalAttempts = maxAttempts * 2;

    while (!done) {
      if (await isCancelled(taskId)) return;

      // Re-checked before every retry and reassignment; the first attempt was
      // already cleared (with hiring margin) before the agent was hired.
      if (!firstAttemptCleared && !hasWindow(ATTEMPT_WINDOW_MS)) {
        await stopForTime(subtask.attemptCount);
        return;
      }
      firstAttemptCleared = false;
      if (subtask.attemptCount >= maxTotalAttempts) {
        await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "qa_failed_max_attempts" });
        await markSkipped(taskId, subtask, "attempts", `no attempt passed review after ${subtask.attemptCount} attempts`, { output: null });
        return;
      }

      localAttempt += 1;
      const attemptNumber = subtask.attemptCount + 1;
      await db.subtask.update({
        where: { id: subtask.id },
        data: { status: "EXECUTING", attemptCount: attemptNumber },
      });
      subtask.attemptCount = attemptNumber;

      await emitEvent(db, {
        taskId,
        actor: active.agent.id,
        eventType: "WORK_STARTED",
        payload: { subtaskId: subtask.id, attempt: attemptNumber, feedback: feedback ?? null },
      });

      const executionStart = Date.now();
      // A crashed worker counts as a failed attempt (not a crashed task), so
      // retry / escrow reallocation kicks in the same way as for bad output.
      let exec: Awaited<ReturnType<typeof executeSubtask>>;
      try {
        exec = await runWithBudget(ATTEMPT_EXEC_BUDGET_MS, () =>
          executeSubtask({
            type: subtask.requiredCapability,
            description: subtask.description ?? subtask.type,
            taskPrompt: task.prompt,
            upstream,
            knownSources,
            feedback,
            taskId: taskId,
            agentId: active.agent.id,
            subtaskId: subtask.id,
          }),
        );
      } catch (err: any) {
        exec = {
          output: `[EXECUTION ERROR] Agent ${active.agent.id} failed to execute: ${err?.message ?? "unknown error"}`,
          actualLatencyMs: Date.now() - executionStart,
          source: "error",
        };
      }
      const actualLatencyMs = Date.now() - executionStart;

      // The segment's deadline may have cut this attempt short: its output
      // can't be trusted or scored, so hand the step to the next segment.
      if (deadlineExhausted()) {
        subtask.attemptCount = attemptNumber - 1;
        await stopForTime(attemptNumber - 1);
        return;
      }

      await db.subtask.update({
        where: { id: subtask.id },
        data: { status: "AWAITING_QA", output: exec.output, artifacts: exec.artifacts ? JSON.stringify(exec.artifacts) : null },
      });

      // Record the result's proof in the trust registry (on-chain anchoring
      // happens in the background) and verify the output against exactly
      // that record.
      const committedPayload = { subtaskId: subtask.id, outputHash: computeSha256(exec.output) };
      const commitRes = await commitWorkflowEvent({
        workflowId: taskId,
        taskId,
        eventType: "RESULT_COMMITTED",
        fromAgentId: active.agent.id,
        toAgentId: "qa",
        payload: committedPayload,
      });
      const verifyRes = await verifyWorkflowEvent(commitRes.id, { subtaskId: subtask.id, outputHash: computeSha256(exec.output) });

      // Anchor result verification on Algorand trust layer
      await commitWorkflowEvent({
        workflowId: taskId,
        taskId,
        eventType: "RESULT_VERIFIED",
        fromAgentId: "qa",
        toAgentId: "system",
        payload: {
          subtaskId: subtask.id,
          verified: verifyRes.success,
          error: verifyRes.error || null,
        },
      });

      if (!verifyRes.success) {
        await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
        await failTask(taskId, `Workflow integrity check failed: ${verifyRes.error}`);
        return;
      }

      await emitEvent(db, {
        taskId,
        actor: active.agent.id,
        eventType: "WORK_COMPLETED",
        payload: { subtaskId: subtask.id, attempt: attemptNumber, preview: exec.output.slice(0, 140), source: exec.source },
      });

      await emitEvent(db, { taskId, actor: "qa", eventType: "QA_STARTED", payload: { subtaskId: subtask.id, attempt: attemptNumber } });

      // When Sarvam IS configured but this specific call still degraded to a
      // placeholder/error (transient provider error, not a global outage),
      // that's an execution failure, not a quality one - submitting it to the
      // real QA model just burns a call judging text that was never the
      // agent's actual work (lib/agents/calibration.ts applies the same
      // "never score a fallback" rule offline). Skip straight to a
      // deterministic failing verdict so retry/reassignment kicks in with an
      // honest reason instead of a misleading "failed QA" message. When
      // Sarvam is NOT configured at all, local-fallback output IS the
      // intended demo-mode path, so it still goes through QA's own
      // structural fallback check as normal.
      let qa =
        isInfraFailure(exec.source) || exec.source === "external_error"
          ? {
              verdict: {
                passed: false,
                score: 0,
                reason:
                  exec.source === "error"
                    ? "Execution crashed before producing output, so there was nothing to review."
                    : exec.source === "external_error"
                      ? `The external agent's endpoint did not return a usable result, so there was nothing substantive to review: ${exec.output}`
                      : "The AI provider errored on this attempt and only a placeholder was produced, so there was nothing substantive to review.",
                issues: [exec.source === "error" ? "execution error" : exec.source === "external_error" ? "external agent execution error" : "provider error during execution"],
              } satisfies QaVerdict,
              source: "rubric" as const,
              notes: [] as string[],
            }
          : await runWithBudget(QA_BUDGET_MS, () =>
              verifySubtaskOutput({
                type: subtask.requiredCapability,
                description: subtask.description ?? subtask.type,
                output: exec.output,
                qualityThreshold: task.qualityThreshold,
                artifacts: exec.artifacts,
                knownSources: [...knownSources, ...(exec.artifacts?.sources ?? [])],
              }),
            );

      // Cross-agent consistency: an output that passed its own QA but states a
      // figure that materially conflicts with an upstream agent's figure for
      // the same quantity is rejected, so the normal retry / reassignment path
      // runs instead of the conflict reaching the report unnoticed.
      if (qa.verdict.passed && upstream.length > 0) {
        const conflicts = findContradictions(exec.output, upstream.map((u) => ({ type: u.type, output: u.output })));
        if (conflicts.length > 0) {
          const issues = conflicts.map(describeContradiction);
          await emitEvent(db, {
            taskId,
            actor: "qa",
            eventType: "CONTRADICTION_DETECTED",
            payload: { subtaskId: subtask.id, agentId: active.agent.id, contradictions: conflicts },
          });
          qa = {
            ...qa,
            verdict: {
              passed: false,
              score: Math.min(qa.verdict.score, 60),
              reason: "Output contradicts an upstream agent's figures; it was not accepted.",
              issues,
            },
          };
        }
      }

      // Same as above for the QA call: a verdict the deadline may have cut
      // short (QA falls back to a structural check) must not pay or penalise.
      if (deadlineExhausted()) {
        subtask.attemptCount = attemptNumber - 1;
        await stopForTime(attemptNumber - 1);
        return;
      }

      if (!isInfraFailure(exec.source)) {
        await recordPerformanceAndUpdateReputation({
          agentId: active.agent.id,
          taskId,
          subtaskId: subtask.id,
          taskType: subtask.type,
          capabilities: [subtask.requiredCapability],
          expectedCost: active.bidAmount,
          actualCost: active.bidAmount,
          expectedLatencyMs: active.agent.avgLatencyMs || actualLatencyMs,
          actualLatencyMs,
          qaScore: qa.verdict.score,
          success: qa.verdict.passed,
        });
      }

      if (qa.verdict.passed) {
        await db.subtask.update({
          where: { id: subtask.id },
          data: { status: "DONE", qaScore: qa.verdict.score, qaReason: qa.verdict.reason },
        });

        // Anchor QA Approved on Algorand trust layer
        await commitWorkflowEvent({
          workflowId: taskId,
          taskId,
          eventType: "QA_APPROVED",
          fromAgentId: "qa",
          toAgentId: "manager",
          payload: {
            subtaskId: subtask.id,
            score: qa.verdict.score,
            reason: qa.verdict.reason,
          },
        });

        await emitEvent(db, {
          taskId,
          actor: "qa",
          eventType: "QA_PASSED",
          payload: { subtaskId: subtask.id, score: qa.verdict.score, reason: qa.verdict.reason },
        });

        if (await isCancelled(taskId)) return; // never pay out a cancelled task, even on a late pass

        const release = await releaseAgentEscrow({
          agentEscrowId: activeEscrowId,
          requestedAmount: active.bidAmount,
          purpose: subtask.requiredCapability,
        });
        if (release.blocked) {
          if (await isCancelled(taskId)) return; // escrow was refunded out from under us by a concurrent cancel - not a real failure
          // Unpaid work is not used: the escrow returns to the budget and the
          // step is disclosed as incomplete, rather than failing the task.
          await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "payout_blocked" });
          await markSkipped(taskId, subtask, "safeguard", `payout blocked by the Circuit Breaker: ${release.reason}`, { output: null });
          return;
        }

        done = true;
      } else {
        // Anchor QA Rejected on Algorand trust layer
        await commitWorkflowEvent({
          workflowId: taskId,
          taskId,
          eventType: "QA_REJECTED",
          fromAgentId: "qa",
          toAgentId: "manager",
          payload: {
            subtaskId: subtask.id,
            score: qa.verdict.score,
            reason: qa.verdict.reason,
          },
        });

        await emitEvent(db, {
          taskId,
          actor: "qa",
          eventType: "QA_FAILED",
          payload: { subtaskId: subtask.id, attempt: attemptNumber, reason: qa.verdict.reason, issues: qa.verdict.issues, qaSource: qa.source },
        });

        // Recording this failure may have just auto-demoted the agent (its
        // third failure in a row, across tasks); never keep working with a
        // demoted agent - go straight to reassignment.
        const stillActive = (await db.agent.findUnique({ where: { id: active.agent.id } }))?.status === "ACTIVE";
        if (localAttempt < maxAttempts && stillActive) {
          // Path A: retry the same agent with QA's specific findings as feedback.
          feedback = qa.verdict.issues.length > 0 ? `${qa.verdict.reason} Specific issues: ${qa.verdict.issues.join("; ")}` : qa.verdict.reason;
          continue;
        }

        // This agent has exhausted its attempts. Its escrow goes back to the
        // task budget, then the manager re-ranks every untried agent on fresh
        // data (updated reputation, real remaining budget) and reallocates
        // the escrow to the best one - repeating up to MAX_REASSIGNMENTS.
        if (reassignments < MAX_REASSIGNMENTS) {
          const failedAgentId = active.agent.id;
          await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "reassigned_to_alternate_agent" });

          // No untried agent left, but this one only failed on a provider
          // timeout/error (not on quality): give it another chance rather
          // than skipping the step. Still bounded by MAX_REASSIGNMENTS.
          const alternate = (await pickReplacement()) ?? (isInfraFailure(exec.source) && stillActive ? active : undefined);
          if (alternate) {
            const reassignLock = await assign(alternate);
            if (reassignLock.blocked) {
              if (await isCancelled(taskId)) return;
              await markSkipped(taskId, subtask, "safeguard", `escrow lock blocked by the Circuit Breaker while reassigning: ${reassignLock.reason}`, { output: null });
              return;
            }

            active = alternate;
            activeEscrowId = reassignLock.agentEscrow.id;
            triedAgentIds.add(alternate.agent.id);
            reassignments += 1;
            localAttempt = 0;
            feedback = undefined;

            await emitEvent(db, {
              taskId,
              actor: "manager",
              eventType: "ESCROW_REALLOCATED",
              payload: {
                subtaskId: subtask.id,
                fromAgentId: failedAgentId,
                toAgentId: alternate.agent.id,
                amount: alternate.bidAmount,
                reassignment: reassignments,
                explanation: alternate.explanation,
              },
            });
            await emitEvent(db, {
              taskId,
              actor: "manager",
              eventType: "WORKFORCE_CONSTRUCTED",
              payload: { subtaskId: subtask.id, agentId: alternate.agent.id, amount: alternate.bidAmount, reassigned: true },
            });
            continue;
          }

          // Escrow already refunded above; no replacement left. Don't abort
          // the whole task over one unstaffable step - skip it (no output,
          // no payment) and let the rest of the workflow run; the gap is
          // disclosed in the final report.
          await markSkipped(taskId, subtask, "quality", `failed QA and no eligible replacement agent was available: ${qa.verdict.reason}`, {
            output: null,
            qaScore: qa.verdict.score,
            qaReason: qa.verdict.reason,
          });
          return;
        }

        // Path C: reassignment limit hit - same soft-skip, not a whole-task failure.
        await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "qa_failed_max_attempts" });
        await markSkipped(taskId, subtask, "quality", `failed QA after ${maxAttempts} attempts (reassignment limit reached): ${qa.verdict.reason}`, {
          output: null,
          qaScore: qa.verdict.score,
          qaReason: qa.verdict.reason,
        });
        return;
      }
    }
  }

  for (const level of buildLevels(subtasks)) {
    const todo = level.filter(unfinished);
    if (todo.length === 0) continue;
    if (await isCancelled(taskId)) return STOPPED;
    await Promise.all(todo.map((subtask) => processSubtask(subtask)));
    if (await isCancelled(taskId)) return STOPPED;
    // A fatal error inside processSubtask (escrow lock blocked, payout
    // blocked, integrity check failed, ...) calls failTask and returns from
    // just that subtask; stop scheduling work once that has happened.
    const afterLevel = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (afterLevel.status === "FAILED") return STOPPED;
    if (yieldState.reason) return { status: "yielded", reason: yieldState.reason };
  }

  // The final review has run: if it found blocking problems, send the work
  // back to the responsible steps, re-run what depends on them, and review
  // again (bounded). Not a task failure - unresolved issues are disclosed.
  // A round can span segments: progress is saved after every revision and
  // the cycle resumes from it. The final outcome is persisted for the report.
  const reviewRow = [...(await db.subtask.findMany({ where: { taskId, requiredCapability: "quality_verification" }, orderBy: { sequence: "asc" } }))].pop();
  if (reviewRow?.status === "DONE" && !task.reviewOutcome) {
    const outcome = await runReworkCycle({
      taskId,
      taskPrompt: task.prompt,
      qualityThreshold: task.qualityThreshold,
      reviewSubtaskId: reviewRow.id,
      isCancelled: () => isCancelled(taskId),
      canContinue: () => hasWindow(ATTEMPT_WINDOW_MS),
      progress: task.reworkProgress ? (JSON.parse(task.reworkProgress) as ReworkProgress) : null,
      saveProgress: (progress) => db.task.update({ where: { id: taskId }, data: { reworkProgress: JSON.stringify(progress) } }),
    });
    if (outcome.cancelled) return STOPPED;
    if (outcome.interrupted) {
      if (!finalSegment) return { status: "yielded", reason: "acting on the final review" };
      // Last allowed segment: stop here and disclose what's unresolved.
      await emitEvent(db, { taskId, actor: "manager", eventType: "REWORK_COMPLETED", payload: { rounds: outcome.rounds, resolved: false, unresolved: outcome.unresolved, reason: OUT_OF_TIME_REASON } });
    }
    await db.task.update({ where: { id: taskId }, data: { reviewOutcome: JSON.stringify({ ...outcome, interrupted: undefined }), reworkProgress: null } });
  }

  if (await isCancelled(taskId)) return STOPPED;
  if (!finalSegment && !hasWindow(FINAL_PHASE_WINDOW_MS)) return { status: "yielded", reason: "assembling the final report" };

  await finalizeTask(taskId);
  return FINISHED;
}

// Assembles the deliverable from the persisted workflow state - it never
// relies on anything held in memory, so it can run in a later segment than
// the work it reports on.
async function finalizeTask(taskId: string) {
  // Every step has settled by now, so nothing may stay locked once the task
  // is terminal; refund anything an interrupted path left behind.
  for (const escrow of await db.agentEscrow.findMany({ where: { taskId, status: "LOCKED" } })) {
    await refundAgentEscrow({ agentEscrowId: escrow.id, reason: "task_finalized" });
  }

  const finalSubtasks = await db.subtask.findMany({ where: { taskId }, orderBy: { sequence: "asc" } });
  const finalTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const avgQuality = finalSubtasks.reduce((s, st) => s + (st.qaScore ?? 0), 0) / Math.max(finalSubtasks.length, 1);

  // Steps that could not be completed (no agent, or QA rejected every
  // attempt and every reassignment, or out of time). They don't abort the
  // task by themselves: the report is built from what DID succeed and the
  // gap is disclosed ("PARTIAL").
  const degraded = finalSubtasks
    .filter((st) => st.status === "FAILED")
    .map((st) => describeIncompleteStep({ type: st.type, requiredCapability: st.requiredCapability, kind: st.skipKind, reason: st.skipReason ?? st.qaReason ?? "did not complete" }));

  const typeBySubtask = new Map(finalSubtasks.map((st) => [st.id, st.type]));
  const sequenceBySubtask = new Map(finalSubtasks.map((st) => [st.id, st.sequence]));
  const payouts = (await db.agentEscrow.findMany({ where: { taskId, status: "RELEASED" } })).sort(
    (a, b) => (sequenceBySubtask.get(a.subtaskId) ?? 0) - (sequenceBySubtask.get(b.subtaskId) ?? 0),
  );
  const agentsUsed = payouts.map((p) => p.agentId);
  const totalCost = payouts.reduce((sum, p) => sum + p.amount, 0);
  const reviewOutcome: ReworkOutcome | null = finalTask.reviewOutcome ? JSON.parse(finalTask.reviewOutcome) : null;

  const assignedIds = [...new Set(finalSubtasks.map((st) => st.assignedAgentId).filter((id): id is string => Boolean(id)))];
  const assignedAgents = assignedIds.length > 0 ? await db.agent.findMany({ where: { id: { in: assignedIds } } }) : [];
  const report = buildFinalReport(finalSubtasks, new Map(assignedAgents.map((a) => [a.id, a.name])));
  // Citations in the deliverable are re-validated against what was actually
  // retrieved, and the Sources list is rendered from that registry - the
  // report can never show a reference that Kraven did not fetch.
  const allSources = await taskSources(taskId);
  const reportBody = stripInvalidCitations(stripModelSourceList(report.content), allSources);

  // Every subtask was skipped or failed and produced nothing: there's no
  // deliverable to disclose a gap in, so this is a full failure after all.
  if (!reportBody.trim()) {
    await failTask(
      taskId,
      degraded.length > 0
        ? `No step produced usable output. ${degraded.map((d) => d.summary).join(" ")}`
        : "No step produced usable output.",
    );
    return;
  }

  const used = sourcesForText(reportBody, allSources);
  const sourcesSection = renderSourcesSection(used.sources, used.citedOnly ? "## Sources" : "## Research sources consulted");
  // The deliverable leads; a short plain-language caveat follows it (the full
  // reviewer detail stays in the audit trail and the details view).
  const limitations = renderLimitationsNote(degraded);
  const reportContent = `${reportBody}${sourcesSection ? `\n\n${sourcesSection}` : ""}${limitations ? `\n\n${limitations}` : ""}`;

  // Reuse the final review's numeric check when it looked at this exact report.
  const reviewArtifacts = finalSubtasks
    .filter((st) => st.requiredCapability === "quality_verification")
    .map((st) => parseArtifacts(st.artifacts))
    .pop();
  const reportRaw = finalSubtasks.find((st) => st.type === report.reportType)?.output ?? "";
  const numericChecks =
    reviewArtifacts?.numericCheck && reviewArtifacts.reviewedReportHash === hashText(reportRaw)
      ? reviewArtifacts.numericCheck
      : await checkReportNumbers(report.content);
  await emitEvent(db, {
    taskId,
    actor: "system",
    eventType: "NUMERIC_CHECK_COMPLETED",
    payload: {
      status: numericChecks.status,
      checked: numericChecks.checked,
      consistent: numericChecks.consistent,
      mismatches: numericChecks.mismatches,
      unevaluable: numericChecks.unevaluable,
      reason: numericChecks.reason ?? null,
    },
  });

  // Overall confidence is computed from evidence actually gathered this
  // task (source diversity, arithmetic consistency, independent review
  // score) - never a model's self-reported confidence. Attached as
  // metadata for the UI; it never rewrites the report text itself.
  const confidence = computeOverallConfidence({
    sources: allSources,
    numeric: numericChecks,
    reviewScore: reviewOutcome?.score ?? null,
  });
  await emitEvent(db, { taskId, actor: "system", eventType: "CONFIDENCE_COMPUTED", payload: confidence });

  // Did the work actually meet the contract fixed at planning time?
  let contractEvaluation: ReturnType<typeof evaluateContract> | null = null;
  if (finalTask.contract) {
    try {
      contractEvaluation = evaluateContract(JSON.parse(finalTask.contract) as TaskContract, {
        subtasks: finalSubtasks,
        qualityScore: reviewOutcome?.score ?? avgQuality,
        budgetUsed: finalTask.budget - finalTask.remainingBudget,
        finishedAt: new Date(),
        sourceCount: allSources.length,
      });
      await emitEvent(db, { taskId, actor: "system", eventType: "CONTRACT_EVALUATED", payload: contractEvaluation });
    } catch {
      contractEvaluation = null; // a malformed stored contract must never block delivery
    }
  }

  const finalOutput = {
    contract_evaluation: contractEvaluation,
    content: reportContent,
    report_from: report.reportType,
    worker_outputs: report.workerOutputs,
    avg_quality: Math.round(avgQuality),
    numeric_checks: numericChecks,
    confidence,
    subtask_types: finalSubtasks.map((st) => st.type),
    incomplete_subtasks: degraded.length > 0 ? degraded : undefined,
    sources: allSources.map((src) => ({ id: src.id, title: src.title, url: src.url, kind: src.kind, cited: used.citedOnly && used.sources.includes(src) })),
    review: reviewOutcome
      ? {
          approved: reviewOutcome.approved,
          score: reviewOutcome.score,
          reworkRounds: reviewOutcome.rounds,
          unresolvedIssues: reviewOutcome.unresolved,
        }
      : null,
    qa_summary: finalSubtasks
      .map((st) => `${st.type}: ${st.qaScore}/100 (${st.attemptCount} attempt${st.attemptCount > 1 ? "s" : ""})`)
      .join("; "),
    spend_summary: {
      budget: finalTask.budget,
      // The task budget is the single source of truth: everything that left it
      // counts as spent - agent payments plus paid data purchases (x402).
      spent: finalTask.budget - finalTask.remainingBudget,
      agentPayments: totalCost,
      dataPurchases: finalTask.budget - finalTask.remainingBudget - totalCost,
      remaining: finalTask.remainingBudget,
      breakdown: payouts.map((p) => ({ agent: p.agentId, subtask: typeBySubtask.get(p.subtaskId) })),
    },
  };

  const finalStatus = degraded.length > 0 ? "PARTIAL" : "COMPLETED";
  await db.task.update({
    where: { id: taskId },
    data: { status: finalStatus, finalOutput: JSON.stringify(finalOutput) },
  });
  await emitEvent(db, { taskId, actor: "manager", eventType: finalStatus === "PARTIAL" ? "TASK_PARTIAL" : "TASK_COMPLETED", payload: finalOutput });

  await storeWorkflow({
    taskId,
    taskType: workflowSignature({ subtasks: finalSubtasks }),
    prompt: finalTask.prompt,
    subtaskTypes: finalSubtasks.map((s) => s.type),
    agentsUsed,
    sequence: finalSubtasks.map((s) => s.id),
    dependencies: Object.fromEntries(finalSubtasks.map((s) => [s.id, JSON.parse(s.dependsOn) as string[]])),
    cost: totalCost,
    latencyMs: Date.now() - new Date(finalTask.createdAt).getTime(),
    quality: avgQuality,
    success: degraded.length === 0,
  });
}

// Cancellation - refunds every still-locked escrow for the task and marks
// in-flight subtasks FAILED. The orchestrator's own isCancelled() checks
// ensure no late payout can slip through after this runs.
export async function cancelTask(taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!["CREATED", "PLANNING", "IN_PROGRESS"].includes(task.status)) {
    return { cancelled: false as const, reason: `task is already ${task.status}` };
  }

  await db.task.update({ where: { id: taskId }, data: { status: "CANCELLING" } });

  await db.subtask.updateMany({
    where: { taskId, status: { in: IN_FLIGHT_SUBTASK_STATUSES } },
    data: { status: "FAILED" },
  });

  const lockedEscrows = await db.agentEscrow.findMany({ where: { taskId, status: "LOCKED" } });
  for (const escrow of lockedEscrows) {
    await refundAgentEscrow({ agentEscrowId: escrow.id, reason: "task_cancelled" });
  }

  await db.task.update({
    where: { id: taskId },
    data: { status: "CANCELLED", finalOutput: JSON.stringify({ content: null, cancelled: true }) },
  });
  await emitEvent(db, { taskId, actor: "system", eventType: "TASK_CANCELLED", payload: {} });

  return { cancelled: true as const };
}
