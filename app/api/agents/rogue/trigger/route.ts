import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { lockAgentEscrow, releaseAgentEscrow } from "@/lib/economy/escrow";
import { issueCredential, CREDENTIAL_OPERATIONS } from "@/lib/economy/credentials";
import { emitEvent } from "@/lib/events/emit";
import { CIRCUIT_BREAKER_DEMO_AGENT_ID, ensureCircuitBreakerDemoAgent } from "@/lib/agents/demoFixture";

const triggerSchema = z.object({ taskId: z.string() });

// Scripted, deterministic rogue-agent demo: a real (small, legitimate)
// escrow lock followed by an oversized payout REQUEST that the Circuit
// Breaker must block - through the exact same code path as every other
// transaction, not a frontend simulation.
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const task = await db.task.findUnique({ where: { id: parsed.data.taskId } });
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  // Allowed even after COMPLETED - per the demo script, the rogue trigger is
  // fired immediately after the happy path finishes. Only excluded once the
  // task's budget itself has been closed out (cancelled/failed).
  if (!["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA", "COMPLETED"].includes(task.status)) {
    return NextResponse.json({ error: `task is ${task.status}, cannot run demo` }, { status: 409 });
  }
  if (task.remainingBudget < 1) {
    return NextResponse.json({ error: "task has no remaining budget to demonstrate against" }, { status: 409 });
  }

  const authorizedAmount = Math.min(8, task.remainingBudget);
  await ensureCircuitBreakerDemoAgent();

  const subtask = await db.subtask.create({
    data: {
      taskId: task.id,
      type: "rogue_demo",
      requiredCapability: "unbounded_payment_request",
      assignedAgentId: CIRCUIT_BREAKER_DEMO_AGENT_ID,
      status: "ASSIGNED",
    },
  });

  // §4 demo: a real scoped credential, capped at the same authorized amount
  // as the escrow - so the oversized payout below is independently blocked
  // by BOTH the Circuit Breaker (purpose/amount) and this credential
  // ceiling, not just one of them.
  const credential = await issueCredential({
    taskId: task.id,
    subtaskId: subtask.id,
    agentId: CIRCUIT_BREAKER_DEMO_AGENT_ID,
    allowedOperations: CREDENTIAL_OPERATIONS,
    maxSpend: authorizedAmount,
  });

  const lock = await lockAgentEscrow({
    taskId: task.id,
    subtaskId: subtask.id,
    agentId: CIRCUIT_BREAKER_DEMO_AGENT_ID,
    amount: authorizedAmount,
    purpose: "market_research",
    credentialId: credential.id,
  });

  if (lock.blocked) {
    await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
    return NextResponse.json({
      ok: true,
      stage: "lock_blocked",
      authorizedAmount,
      requestedAmount: authorizedAmount,
      blocked: true,
      reason: lock.reason,
    });
  }

  await emitEvent(db, {
    taskId: task.id,
    actor: CIRCUIT_BREAKER_DEMO_AGENT_ID,
    eventType: "WORK_STARTED",
    payload: { subtaskId: subtask.id, note: "rogue agent authorized for a small legitimate amount" },
  });

  const rogueAmount = 10_000;
  const release = await releaseAgentEscrow({
    agentEscrowId: lock.agentEscrow.id,
    requestedAmount: rogueAmount,
    purpose: "unbounded_payment_request",
  });

  await db.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });

  return NextResponse.json({
    ok: true,
    stage: "payout_request",
    authorizedAmount,
    requestedAmount: rogueAmount,
    credentialId: credential.id,
    credentialMaxSpend: credential.maxSpend,
    blocked: release.blocked,
    reason: release.blocked ? release.reason : null,
  });
}
