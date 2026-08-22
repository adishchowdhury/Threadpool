import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events/bus";
import type { Prisma } from "@/app/generated/prisma/client";

export const EVENT_TYPES = [
  "TASK_CREATED",
  "MANAGER_PLANNING",
  "SUBTASK_CREATED",
  "AGENTS_DISCOVERED",
  "AGENTS_FILTERED",
  "AGENTS_RANKED",
  "BID_RECEIVED",
  "AGENT_SELECTED",
  "WORKFORCE_CONSTRUCTED",
  "ESCROW_LOCKED",
  "WORK_STARTED",
  "WORK_COMPLETED",
  "QA_STARTED",
  "QA_PASSED",
  "QA_FAILED",
  "PAYOUT_REQUESTED",
  "TRANSACTION_APPROVED",
  "TRANSACTION_BLOCKED",
  "WALLET_REVOKED",
  "TASK_CANCELLED",
  "ESCROW_REFUNDED",
  "TASK_FAILED",
  "TASK_COMPLETED",
  "REPUTATION_UPDATED",
  "WORKFLOW_MEMORY_STORED",
  "WORKFLOW_ANCHORED",
] as const;

export type MomentumEventType = (typeof EVENT_TYPES)[number];

// Accepts an optional transaction client so callers inside a
// prisma.$transaction() can emit atomically with the mutation they describe.
export async function emitEvent(
  db: Prisma.TransactionClient | typeof prisma,
  params: { taskId?: string | null; actor: string; eventType: MomentumEventType; payload?: unknown },
) {
  const row = await db.event.create({
    data: {
      taskId: params.taskId ?? null,
      actor: params.actor,
      eventType: params.eventType,
      payload: JSON.stringify(params.payload ?? {}),
    },
  });
  publish({
    id: row.id,
    taskId: row.taskId,
    actor: row.actor,
    eventType: row.eventType,
    payload: params.payload ?? {},
    createdAt: row.createdAt.toISOString(),
  });
  return row;
}
