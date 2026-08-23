import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";
import { commitWorkflowEvent, verifyWorkflowEvent, computeSha256 } from "@/lib/blockchain/algorandTrust";
import { decomposeTask } from "@/lib/manager/planner";
import { discoverAgents } from "@/lib/discovery";
import { filterCandidates } from "@/lib/manager/filter";
import { collectBids } from "@/lib/manager/bidding";
import { rankCandidates } from "@/lib/manager/rank";
import { lockAgentEscrow, releaseAgentEscrow, refundAgentEscrow } from "@/lib/economy/escrow";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { recordPerformanceAndUpdateReputation } from "@/lib/economy/reputation";
import { findSimilarWorkflow, storeWorkflow } from "@/lib/manager/workflowMemory";
import { PromptOptimizationRouter } from "@/lib/optimizer";

async function isCancelled(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  return task.status === "CANCELLED" || task.status === "CANCELLING";
}

async function failTask(taskId: string, reason: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.status === "CANCELLED" || task.status === "CANCELLING" || task.status === "COMPLETED") return;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "FAILED",
      finalOutput: JSON.stringify({
        content: null,
        failure_reason: reason,
      }),
    },
  });
  await emitEvent(prisma, { taskId, actor: "manager", eventType: "TASK_FAILED", payload: { reason } });
}

// Drives the whole task lifecycle end-to-end. Intended to be fired-and-not-
// awaited by the API route; all state changes are visible via the Event/SSE
// stream and by polling GET /api/tasks/:id.
export async function runTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (await isCancelled(taskId)) return;

  await prisma.task.update({ where: { id: taskId }, data: { status: "PLANNING" } });

  let activePrompt = task.prompt;

  if (task.optimizationMode === "B") {
    await emitEvent(prisma, { taskId, actor: "manager", eventType: "MOMENTUM_OPTIMIZER_STARTED", payload: { prompt: task.prompt } });
    const start = Date.now();
    const router = new PromptOptimizationRouter();
    try {
      const optimized = await router.optimize({ prompt: task.prompt });
      const latency = Date.now() - start;

      await prisma.task.update({
        where: { id: taskId },
        data: {
          isOptimized: true,
          optimizedTaskSpec: JSON.stringify(optimized),
          optimizerModel: process.env.PROMPT_MODEL_ENABLED === "false" ? "gemini-fallback" : "Qwen3-0.6B",
          optimizerLatencyMs: latency,
        },
      });

      activePrompt = `Objective: ${optimized.objective}\nTask Type: ${optimized.taskType}\nCapabilities: ${optimized.requiredCapabilities.join(", ")}\nScope: ${JSON.stringify(optimized.scope)}\nConstraints: ${JSON.stringify(optimized.constraints)}\nVerification Requirements: ${JSON.stringify(optimized.verificationRequirements)}`;

      await emitEvent(prisma, {
        taskId,
        actor: "manager",
        eventType: "MOMENTUM_OPTIMIZER_COMPLETED",
        payload: {
          optimizedTask: optimized,
          latencyMs: latency,
          model: process.env.PROMPT_MODEL_ENABLED === "false" ? "gemini-fallback" : "Qwen3-0.6B",
        },
      });
    } catch (err: any) {
      console.error("[Orchestrator] Prompt optimization failed, using raw prompt:", err);
      await emitEvent(prisma, { taskId, actor: "manager", eventType: "MOMENTUM_OPTIMIZER_FAILED", payload: { error: err.message } });
    }
  }

  await emitEvent(prisma, { taskId, actor: "manager", eventType: "MANAGER_PLANNING", payload: { prompt: activePrompt } });

  const { plan, source: planSource } = await decomposeTask({ prompt: activePrompt, budget: task.budget });
  if (await isCancelled(taskId)) return;

  const taskType = plan.subtasks[0]?.requiredCapability ?? "general";
  const memory = await findSimilarWorkflow(taskType, task.prompt);
  if (memory) {
    await emitEvent(prisma, {
      taskId,
      actor: "system",
      eventType: "WORKFLOW_MEMORY_STORED", // reused as "recalled" signal for the UI timeline
      payload: { recalled: true, similarity: memory.similarity, agentsUsed: JSON.parse(memory.memory.agentsUsed) },
    });
  }

  // Create subtask rows, mapping the plan's sequence numbers to real ids
  // so dependsOn can be stored as actual subtask ids.
  const seqToId = new Map<number, string>();
  const createdSubtasks = [];
  for (const sp of [...plan.subtasks].sort((a, b) => a.sequence - b.sequence)) {
    const row = await prisma.subtask.create({
      data: {
        taskId,
        type: sp.type,
        requiredCapability: sp.requiredCapability,
        sequence: sp.sequence,
        dependsOn: JSON.stringify(sp.dependsOnSequence.map((s) => seqToId.get(s)).filter(Boolean)),
      },
    });
    seqToId.set(sp.sequence, row.id);
    createdSubtasks.push(row);
    await emitEvent(prisma, {
      taskId,
      actor: "manager",
      eventType: "SUBTASK_CREATED",
      payload: { subtaskId: row.id, type: sp.type, requiredCapability: sp.requiredCapability, planSource },
    });
  }

  if (await isCancelled(taskId)) return;
  await prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });

  const agentsUsed: string[] = [];
  let totalCost = 0;
  const workStart = Date.now();

  for (const subtask of createdSubtasks) {
    if (await isCancelled(taskId)) return;

    const currentTask = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "BIDDING" } });

    const discovered = await discoverAgents(subtask.requiredCapability);
    await emitEvent(prisma, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_DISCOVERED",
      payload: { subtaskId: subtask.id, count: discovered.length, agentIds: discovered.map((a) => a.id) },
    });

    const filtered = filterCandidates(discovered, currentTask.remainingBudget);
    await emitEvent(prisma, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_FILTERED",
      payload: { subtaskId: subtask.id, count: filtered.length, agentIds: filtered.map((a) => a.id) },
    });

    if (filtered.length === 0) {
      await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
      await failTask(taskId, `No eligible agent available for subtask '${subtask.type}' within remaining budget.`);
      return;
    }

    const bids = await collectBids({ taskId, subtaskId: subtask.id, candidates: filtered });
    const ranked = await rankCandidates({
      candidates: filtered,
      bids,
      requiredCapability: subtask.requiredCapability,
      taskType: subtask.type,
    });

    await emitEvent(prisma, {
      taskId,
      actor: "manager",
      eventType: "AGENTS_RANKED",
      payload: { subtaskId: subtask.id, ranking: ranked.map((r) => ({ agentId: r.agent.id, score: r.totalScore })) },
    });

    // `active` tracks whichever agent currently holds the escrow for this
    // subtask — it can change mid-loop via reassignment (§8.2 path B).
    let active = ranked[0];
    let activeEscrowId: string;
    const triedAgentIds = new Set<string>();
    let reassignedOnce = false;

    async function assign(candidate: (typeof ranked)[number]) {
      await prisma.subtask.update({
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

      await emitEvent(prisma, {
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
      if (await isCancelled(taskId)) return; // cancellation, not a real failure — don't mark the task FAILED
      await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
      await failTask(taskId, `Escrow lock blocked for subtask '${subtask.type}': ${firstLock.reason}`);
      return;
    }
    activeEscrowId = firstLock.agentEscrow.id;
    triedAgentIds.add(active.agent.id);

    await emitEvent(prisma, {
      taskId,
      actor: "manager",
      eventType: "WORKFORCE_CONSTRUCTED",
      payload: { subtaskId: subtask.id, agentId: active.agent.id, amount: active.bidAmount },
    });

    let feedback: string | undefined;
    let done = false;
    let localAttempt = 0; // attempts against the CURRENTLY assigned agent
    const maxAttempts = subtask.maxAttempts;

    while (!done) {
      if (await isCancelled(taskId)) return;

      localAttempt += 1;
      const attemptNumber = subtask.attemptCount + 1;
      await prisma.subtask.update({
        where: { id: subtask.id },
        data: { status: "EXECUTING", attemptCount: attemptNumber },
      });
      subtask.attemptCount = attemptNumber;

      await emitEvent(prisma, {
        taskId,
        actor: active.agent.id,
        eventType: "WORK_STARTED",
        payload: { subtaskId: subtask.id, attempt: attemptNumber, feedback: feedback ?? null },
      });

      const executionStart = Date.now();
      const exec = await executeSubtask({
        type: subtask.requiredCapability,
        description: subtask.type,
        taskPrompt: task.prompt,
        feedback,
        taskId: taskId,
        agentId: active.agent.id,
      });
      const actualLatencyMs = Date.now() - executionStart;

      await prisma.subtask.update({
        where: { id: subtask.id },
        data: { status: "AWAITING_QA", output: exec.output },
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

      // Verify workflow event integrity
      const verifyRes = await verifyWorkflowEvent(
        taskId,
        "RESULT_COMMITTED",
        {
          subtaskId: subtask.id,
          outputHash: computeSha256(exec.output),
        }
      );

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
        await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
        await failTask(taskId, `Workflow integrity check failed: ${verifyRes.error}`);
        return;
      }

      await emitEvent(prisma, {
        taskId,
        actor: active.agent.id,
        eventType: "WORK_COMPLETED",
        payload: { subtaskId: subtask.id, attempt: attemptNumber, preview: exec.output.slice(0, 140), source: exec.source },
      });

      await emitEvent(prisma, { taskId, actor: "qa", eventType: "QA_STARTED", payload: { subtaskId: subtask.id, attempt: attemptNumber } });

      const qa = await verifySubtaskOutput({
        type: subtask.requiredCapability,
        description: subtask.type,
        output: exec.output,
        qualityThreshold: task.qualityThreshold,
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
        await prisma.subtask.update({
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

        await emitEvent(prisma, {
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
          if (await isCancelled(taskId)) return; // escrow was refunded out from under us by a concurrent cancel — not a real failure
          await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
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

        await emitEvent(prisma, {
          taskId,
          actor: "qa",
          eventType: "QA_FAILED",
          payload: { subtaskId: subtask.id, attempt: attemptNumber, reason: qa.verdict.reason },
        });

        if (localAttempt < maxAttempts) {
          // Path A: retry the same agent with QA feedback appended.
          feedback = qa.verdict.reason;
          continue;
        }

        // This agent has exhausted its attempts. Look for an alternate,
        // untried, still-eligible candidate before giving up entirely.
        const alternate = !reassignedOnce
          ? ranked.find((r) => !triedAgentIds.has(r.agent.id) && r.agent.status === "ACTIVE" && r.bidAmount <= currentTask.remainingBudget)
          : undefined;

        if (alternate) {
          // Path B: reassign to an alternate worker. Refund the exhausted
          // agent's escrow, lock a fresh one for the alternate, and give
          // it its own full attempt budget with no carried-over feedback.
          await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "reassigned_to_alternate_agent" });

          const reassignLock = await assign(alternate);
          if (reassignLock.blocked) {
            if (await isCancelled(taskId)) return;
            await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
            await failTask(taskId, `Escrow lock blocked while reassigning subtask '${subtask.type}': ${reassignLock.reason}`);
            return;
          }

          active = alternate;
          activeEscrowId = reassignLock.agentEscrow.id;
          triedAgentIds.add(alternate.agent.id);
          reassignedOnce = true;
          localAttempt = 0;
          feedback = undefined;

          await emitEvent(prisma, {
            taskId,
            actor: "manager",
            eventType: "WORKFORCE_CONSTRUCTED",
            payload: { subtaskId: subtask.id, agentId: alternate.agent.id, amount: alternate.bidAmount, reassigned: true },
          });
          continue;
        }

        // Path C: terminate — no alternate available, refund, fail.
        await refundAgentEscrow({ agentEscrowId: activeEscrowId, reason: "qa_failed_max_attempts" });
        await prisma.subtask.update({
          where: { id: subtask.id },
          data: { status: "FAILED", qaScore: qa.verdict.score, qaReason: qa.verdict.reason },
        });
        await failTask(taskId, `Subtask '${subtask.type}' failed QA after ${maxAttempts} attempts: ${qa.verdict.reason}`);
        return;
      }
    }
  }

  if (await isCancelled(taskId)) return;

  const finalSubtasks = await prisma.subtask.findMany({ where: { taskId }, orderBy: { sequence: "asc" } });
  const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const avgQuality =
    finalSubtasks.reduce((s, st) => s + (st.qaScore ?? 0), 0) / Math.max(finalSubtasks.length, 1);

  const finalOutput = {
    content: finalSubtasks.map((st) => `### ${st.type}\n\n${st.output ?? ""}`).join("\n\n---\n\n"),
    sources: finalSubtasks.map((st) => st.type),
    qa_summary: finalSubtasks
      .map((st) => `${st.type}: ${st.qaScore}/100 (${st.attemptCount} attempt${st.attemptCount > 1 ? "s" : ""})`)
      .join("; "),
    spend_summary: {
      budget: finalTask.budget,
      spent: totalCost,
      remaining: finalTask.remainingBudget,
      breakdown: agentsUsed.map((agentId, i) => ({ agent: agentId, subtask: finalSubtasks[i]?.type })),
    },
  };

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "COMPLETED", finalOutput: JSON.stringify(finalOutput) },
  });
  await emitEvent(prisma, { taskId, actor: "manager", eventType: "TASK_COMPLETED", payload: finalOutput });

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
    success: true,
  });
}

// Cancellation — refunds every still-locked escrow for the task and marks
// in-flight subtasks FAILED. The orchestrator's own isCancelled() checks
// ensure no late payout can slip through after this runs.
export async function cancelTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!["CREATED", "PLANNING", "IN_PROGRESS"].includes(task.status)) {
    return { cancelled: false as const, reason: `task is already ${task.status}` };
  }

  await prisma.task.update({ where: { id: taskId }, data: { status: "CANCELLING" } });

  await prisma.subtask.updateMany({
    where: { taskId, status: { in: ["EXECUTING", "AWAITING_QA", "BIDDING", "ASSIGNED"] } },
    data: { status: "FAILED" },
  });

  const lockedEscrows = await prisma.agentEscrow.findMany({ where: { taskId, status: "LOCKED" } });
  for (const escrow of lockedEscrows) {
    await refundAgentEscrow({ agentEscrowId: escrow.id, reason: "task_cancelled" });
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "CANCELLED", finalOutput: JSON.stringify({ content: null, cancelled: true }) },
  });
  await emitEvent(prisma, { taskId, actor: "system", eventType: "TASK_CANCELLED", payload: {} });

  return { cancelled: true as const };
}
