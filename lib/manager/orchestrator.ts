import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { commitWorkflowEvent, verifyWorkflowEvent, computeSha256 } from "@/lib/blockchain/algorandTrust";
import { decomposeTask, fitPlanToBudget, workflowSignature } from "@/lib/manager/planner";
import { priceFloorByCapability, reserveForLaterSteps, loadUpstream, taskSources, parseArtifacts } from "@/lib/manager/workflowContext";
import { runReworkCycle } from "@/lib/manager/rework";
import { hashText } from "@/lib/capabilities/review";
import { renderSourcesSection, sourcesForText, stripInvalidCitations, stripModelSourceList } from "@/lib/capabilities/sources";
import { discoverAgents } from "@/lib/discovery";
import { filterCandidatesStaged } from "@/lib/manager/filter";
import { collectBids } from "@/lib/manager/bidding";
import { rankCandidates } from "@/lib/manager/rank";
import { lockAgentEscrow, releaseAgentEscrow, refundAgentEscrow } from "@/lib/economy/escrow";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import type { QaVerdict } from "@/lib/manager/schemas";
import { checkReportNumbers } from "@/lib/manager/numericCheck";
import { buildFinalReport } from "@/lib/manager/finalReport";
import { recordPerformanceAndUpdateReputation } from "@/lib/economy/reputation";
import { findSimilarWorkflow, storeWorkflow } from "@/lib/manager/workflowMemory";

// Max times one subtask's escrow may be moved to a different agent after the
// current one fails.
const MAX_REASSIGNMENTS = 3;

async function isCancelled(taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  return task.status === "CANCELLED" || task.status === "CANCELLING";
}

async function failTask(taskId: string, reason: string) {
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

// Drives the whole task lifecycle end-to-end. Intended to be fired-and-not-
// awaited by the API route; all state changes are visible via the Event/SSE
// stream and by polling GET /api/tasks/:id.
export async function runTask(taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (await isCancelled(taskId)) return;

  await db.task.update({ where: { id: taskId }, data: { status: "PLANNING" } });

  await emitEvent(db, { taskId, actor: "manager", eventType: "MANAGER_PLANNING", payload: { prompt: task.prompt } });

  const decomposed = await decomposeTask({ prompt: task.prompt, budget: task.budget, qualityThreshold: task.qualityThreshold });
  const planSource = decomposed.source;
  if (await isCancelled(taskId)) return;

  // Fit the proposed workflow to what the market can actually staff within
  // the budget (cheapest hireable price per capability).
  const floor = await priceFloorByCapability();
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

  const taskType = workflowSignature(plan);
  const memory = await findSimilarWorkflow(taskType, task.prompt);
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
  const createdSubtasks = [];
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
    createdSubtasks.push(row);
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "SUBTASK_CREATED",
      payload: { subtaskId: row.id, type: sp.type, requiredCapability: sp.requiredCapability, sequence: sp.sequence, dependsOnSequence: sp.dependsOnSequence, planSource },
    });
  }

  if (await isCancelled(taskId)) return;
  await db.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });

  const agentsUsed: string[] = [];
  let totalCost = 0;
  let reviewOutcome: Awaited<ReturnType<typeof runReworkCycle>> | null = null;
  const workStart = Date.now();
  // Subtasks that could not be completed (no agent, or QA rejected every
  // attempt and every reassignment). These don't abort the task by
  // themselves - buildFinalReport already skips subtasks with no output, so
  // the workflow finishes in a degraded ("PARTIAL") state with the gap
  // disclosed, rather than discarding every subtask that DID succeed.
  const degraded: Array<{ type: string; requiredCapability: string; reason: string }> = [];

  for (const subtask of createdSubtasks) {
    if (await isCancelled(taskId)) return;

    const currentTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });

    await db.subtask.update({ where: { id: subtask.id }, data: { status: "BIDDING" } });

    const discovered = await discoverAgents(subtask.requiredCapability);
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_DISCOVERED",
      payload: { subtaskId: subtask.id, count: discovered.length, agentIds: discovered.map((a) => a.id) },
    });

    // Hold back enough budget to staff every later step at the market floor.
    const reserve = reserveForLaterSteps(createdSubtasks, subtask.sequence, floor);
    const spendCap = Math.max(0, currentTask.remainingBudget - reserve);
    const { eligible: filtered, stages } = filterCandidatesStaged(discovered, currentTask.remainingBudget, currentTask.qualityThreshold, spendCap);
    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_FILTERED",
      payload: { subtaskId: subtask.id, count: filtered.length, stages, agentIds: filtered.map((a) => a.id), reserve, spendCap },
    });

    if (filtered.length === 0) {
      const reason = `No eligible agent available for subtask '${subtask.type}' within remaining budget.`;
      await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
      await emitEvent(db, { taskId, actor: "manager", eventType: "SUBTASK_SKIPPED", payload: { subtaskId: subtask.id, type: subtask.type, reason } });
      degraded.push({ type: subtask.type, requiredCapability: subtask.requiredCapability, reason });
      continue;
    }

    const bids = await collectBids({ taskId, subtaskId: subtask.id, candidates: filtered });
    const ranked = await rankCandidates({
      candidates: filtered,
      bids,
      requiredCapability: subtask.requiredCapability,
      taskType: subtask.type,
      qualityThreshold: currentTask.qualityThreshold,
    });

    await emitEvent(db, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_RANKED",
      payload: { subtaskId: subtask.id, ranking: ranked.map((r) => ({ agentId: r.agent.id, score: r.totalScore })) },
    });

    // `active` tracks whichever agent currently holds the escrow for this
    // subtask - it can change mid-loop via reassignment (§8.2 path B).
    let active = ranked[0];
    let activeEscrowId: string;
    const triedAgentIds = new Set<string>();
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

      const lockResult = await lockAgentEscrow({
        taskId,
        subtaskId: subtask.id,
        agentId: candidate.agent.id,
        amount: candidate.bidAmount,
        purpose: subtask.requiredCapability,
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

    const firstLock = await assign(active);
    if (firstLock.blocked) {
      if (await isCancelled(taskId)) return; // cancellation, not a real failure - don't mark the task FAILED
      await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
      await failTask(taskId, `Escrow lock blocked for subtask '${subtask.type}': ${firstLock.reason}`);
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
    // subtasks it depends on (they are DONE - the loop runs in order), plus
    // every source retrieved so far in the task for citation.
    const upstream = await loadUpstream(subtask);
    const knownSources = await taskSources(taskId);

    let feedback: string | undefined;
    let done = false;
    let localAttempt = 0; // attempts against the CURRENTLY assigned agent
    const maxAttempts = subtask.maxAttempts;
    let qaExhausted = false; // soft-skipped: ran out of agents, didn't actually pass

    while (!done) {
      if (await isCancelled(taskId)) return;

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
        exec = await executeSubtask({
          type: subtask.requiredCapability,
          description: subtask.description ?? subtask.type,
          taskPrompt: task.prompt,
          upstream,
          knownSources,
          feedback,
          taskId: taskId,
          agentId: active.agent.id,
          subtaskId: subtask.id,
        });
      } catch (err: any) {
        exec = {
          output: `[EXECUTION ERROR] Agent ${active.agent.id} failed to execute: ${err?.message ?? "unknown error"}`,
          actualLatencyMs: Date.now() - executionStart,
          source: "error",
        };
      }
      const actualLatencyMs = Date.now() - executionStart;

      await db.subtask.update({
        where: { id: subtask.id },
        data: { status: "AWAITING_QA", output: exec.output, artifacts: exec.artifacts ? JSON.stringify(exec.artifacts) : null },
      });

      // Anchor result commitment on Algorand trust layer
      const commitRes = await commitWorkflowEvent({
        workflowId: taskId,
        taskId,
        eventType: "RESULT_COMMITTED",
        fromAgentId: active.agent.id,
        toAgentId: "qa",
        payload: {
          subtaskId: subtask.id,
          outputHash: computeSha256(exec.output),
        },
      });

      // Verify workflow event integrity - only against a commitment that was
      // actually recorded for THIS output. If anchoring itself failed (network,
      // chain unavailable) there is nothing to verify against; looking up the
      // latest older commitment instead (a previous attempt's) reported a
      // false integrity breach and failed the task. The trust layer is
      // optional and must never take the workflow down on an outage.
      const verifyRes =
        commitRes.status === "FAILED"
          ? { success: true as const, error: `anchoring unavailable - not verified (${commitRes.id})` }
          : await verifyWorkflowEvent(taskId, "RESULT_COMMITTED", {
              subtaskId: subtask.id,
              outputHash: computeSha256(exec.output),
            });

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
      const qa =
        (exec.source === "local_fallback" && isSarvamConfigured()) || exec.source === "error"
          ? {
              verdict: {
                passed: false,
                score: 0,
                reason:
                  exec.source === "error"
                    ? "Execution crashed before producing output, so there was nothing to review."
                    : "The AI provider errored on this attempt and only a placeholder was produced, so there was nothing substantive to review.",
                issues: [exec.source === "error" ? "execution error" : "provider error during execution"],
              } satisfies QaVerdict,
              source: "rubric" as const,
              notes: [] as string[],
            }
          : await verifySubtaskOutput({
              type: subtask.requiredCapability,
              description: subtask.description ?? subtask.type,
              output: exec.output,
              qualityThreshold: task.qualityThreshold,
              artifacts: exec.artifacts,
              knownSources: [...knownSources, ...(exec.artifacts?.sources ?? [])],
            });

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
          await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
          await failTask(taskId, `Payout blocked unexpectedly for subtask '${subtask.type}': ${release.reason}`);
          return;
        }

        agentsUsed.push(active.agent.id);
        totalCost += active.bidAmount;
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

        if (localAttempt < maxAttempts) {
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

          const alternate = await pickReplacement();
          if (alternate) {
            const reassignLock = await assign(alternate);
            if (reassignLock.blocked) {
              if (await isCancelled(taskId)) return;
              await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
              await failTask(taskId, `Escrow lock blocked while reassigning subtask '${subtask.type}': ${reassignLock.reason}`);
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
          // disclosed in the final report (§ task-level PARTIAL handling below).
          const reason = `failed QA and no eligible replacement agent was available: ${qa.verdict.reason}`;
          await db.subtask.update({
            where: { id: subtask.id },
            data: { status: "FAILED", output: null, qaScore: qa.verdict.score, qaReason: qa.verdict.reason },
          });
          await emitEvent(db, { taskId, actor: "manager", eventType: "SUBTASK_SKIPPED", payload: { subtaskId: subtask.id, type: subtask.type, reason } });
          degraded.push({ type: subtask.type, requiredCapability: subtask.requiredCapability, reason });
          qaExhausted = true;
          done = true;
          continue;
        }

        // Path C: reassignment limit hit - same soft-skip as above, not a
        // whole-task failure.
        {
          const reason = `failed QA after ${maxAttempts} attempts (reassignment limit reached): ${qa.verdict.reason}`;
          await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "qa_failed_max_attempts" });
          await db.subtask.update({
            where: { id: subtask.id },
            data: { status: "FAILED", output: null, qaScore: qa.verdict.score, qaReason: qa.verdict.reason },
          });
          await emitEvent(db, { taskId, actor: "manager", eventType: "SUBTASK_SKIPPED", payload: { subtaskId: subtask.id, type: subtask.type, reason } });
          degraded.push({ type: subtask.type, requiredCapability: subtask.requiredCapability, reason });
          qaExhausted = true;
          done = true;
          continue;
        }
      }
    }

    // The final review has run: if it found blocking problems, send the work
    // back to the responsible steps, re-run what depends on them, and review
    // again (bounded). Not a task failure - unresolved issues are disclosed.
    // Skipped if this very subtask was itself soft-skipped above (no QA
    // verdict to act on).
    if (subtask.requiredCapability === "quality_verification" && !qaExhausted) {
      const outcome = await runReworkCycle({
        taskId,
        taskPrompt: task.prompt,
        qualityThreshold: task.qualityThreshold,
        reviewSubtaskId: subtask.id,
        isCancelled: () => isCancelled(taskId),
      });
      if (outcome.cancelled) return;
      reviewOutcome = outcome;
    }
  }

  if (await isCancelled(taskId)) return;

  const finalSubtasks = await db.subtask.findMany({ where: { taskId }, orderBy: { sequence: "asc" } });
  const finalTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const avgQuality =
    finalSubtasks.reduce((s, st) => s + (st.qaScore ?? 0), 0) / Math.max(finalSubtasks.length, 1);

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
        ? `No subtask produced usable output. ${degraded.map((d) => `'${d.type}' ${d.reason}`).join(" ")}`
        : "No subtask produced usable output.",
    );
    return;
  }

  const used = sourcesForText(reportBody, allSources);
  const sourcesSection = renderSourcesSection(used.sources, used.citedOnly ? "## Sources" : "## Research sources consulted");
  const degradedNote =
    degraded.length > 0
      ? `> **Incomplete:** ${degraded.map((d) => `${d.type.replace(/_/g, " ")} (${d.reason})`).join("; ")}. The rest of the workforce completed its work; this report reflects what could be produced without it.\n\n`
      : "";
  const reportContent = `${degradedNote}${reportBody}${sourcesSection ? `\n\n${sourcesSection}` : ""}`;

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

  const finalOutput = {
    content: reportContent,
    report_from: report.reportType,
    worker_outputs: report.workerOutputs,
    avg_quality: Math.round(avgQuality),
    numeric_checks: numericChecks,
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
      breakdown: agentsUsed.map((agentId, i) => ({ agent: agentId, subtask: finalSubtasks[i]?.type })),
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
    taskType,
    prompt: task.prompt,
    subtaskTypes: finalSubtasks.map((s) => s.type),
    agentsUsed,
    sequence: finalSubtasks.map((s) => s.id),
    dependencies: Object.fromEntries(finalSubtasks.map((s) => [s.id, JSON.parse(s.dependsOn) as string[]])),
    cost: totalCost,
    latencyMs: Date.now() - workStart,
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
    where: { taskId, status: { in: ["EXECUTING", "AWAITING_QA", "BIDDING", "ASSIGNED"] } },
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
