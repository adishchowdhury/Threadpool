import { db } from "@/lib/db/client";
import { publish } from "@/lib/events/bus";
import type { DbClient } from "@/lib/db/client";

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
  "ESCROW_REALLOCATED",
  "TASK_FAILED",
  "TASK_COMPLETED",
  "TASK_PARTIAL",
  "SUBTASK_SKIPPED",
  "REPUTATION_UPDATED",
  "WORKFLOW_MEMORY_STORED",
  "WORKFLOW_ANCHORED",
  "WEB_DATA_FETCHED",
  "NUMERIC_CHECK_COMPLETED",
  "CONFIDENCE_COMPUTED",
  "PLAN_ADJUSTED",
  "TOOL_CALLED",
  "INTEGRATION_REVIEW_COMPLETED",
  "REWORK_REQUESTED",
  "REWORK_COMPLETED",
  "PERMISSION_ISSUED",
  "PERMISSION_DENIED",
  "PERMISSION_REVOKED",
  "AGENT_AUTO_DEMOTED",
] as const;

export type KravenEventType = (typeof EVENT_TYPES)[number];

// Accepts an optional transaction client so callers inside a
// db.$transaction() can emit atomically with the mutation they describe.
export async function emitEvent(
  db: DbClient,
  params: { taskId?: string | null; actor: string; eventType: KravenEventType; payload?: unknown },
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
