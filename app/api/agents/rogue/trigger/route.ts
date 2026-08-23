import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockAgentEscrow, releaseAgentEscrow } from "@/lib/economy/escrow";
import { emitEvent } from "@/lib/events/emit";

const triggerSchema = z.object({ taskId: z.string() });

// Scripted, deterministic rogue-agent demo: a real (small, legitimate)
// escrow lock followed by an oversized payout REQUEST that the Circuit
// Breaker must block — through the exact same code path as every other
// transaction, not a frontend simulation.
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  // Allowed even after COMPLETED — per the demo script, the rogue trigger is
  // fired immediately after the happy path finishes. Only excluded once the
  // task's budget itself has been closed out (cancelled/failed).
  if (!["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA", "COMPLETED"].includes(task.status)) {
    return NextResponse.json({ error: `task is ${task.status}, cannot run demo` }, { status: 409 });
  }
  if (task.remainingBudget < 1) {
    return NextResponse.json({ error: "task has no remaining budget to demonstrate against" }, { status: 409 });
  }

  const authorizedAmount = Math.min(8, task.remainingBudget);

  const subtask = await prisma.subtask.create({
    data: {
      taskId: task.id,
      type: "rogue_demo",
      requiredCapability: "unbounded_payment_request",
      assignedAgentId: "rogue-agent",
      status: "ASSIGNED",
    },
  });

  const lock = await lockAgentEscrow({
    taskId: task.id,
    subtaskId: subtask.id,
    agentId: "rogue-agent",
    amount: authorizedAmount,
    purpose: "market_research",
  });

  if (lock.blocked) {
    await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });
    return NextResponse.json({
      ok: true,
      stage: "lock_blocked",
      authorizedAmount,
      requestedAmount: authorizedAmount,
      blocked: true,
      reason: lock.reason,
    });
  }

  await emitEvent(prisma, {
    taskId: task.id,
    actor: "rogue-agent",
    eventType: "WORK_STARTED",
    payload: { subtaskId: subtask.id, note: "rogue agent authorized for a small legitimate amount" },
  });

  const rogueAmount = 10_000;
  const release = await releaseAgentEscrow({
    agentEscrowId: lock.agentEscrow.id,
    requestedAmount: rogueAmount,
    purpose: "unbounded_payment_request",
  });

  await prisma.subtask.update({ where: { id: subtask.id }, data: { status: "FAILED" } });

  return NextResponse.json({
    ok: true,
    stage: "payout_request",
    authorizedAmount,
    requestedAmount: rogueAmount,
    blocked: release.blocked,
    reason: release.blocked ? release.reason : null,
  });
}
