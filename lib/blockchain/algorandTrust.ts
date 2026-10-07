import crypto from "crypto";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { isRealAlgorandConfigured, submitAnchorTransaction } from "@/lib/blockchain/algosdkClient";
import { runInBackground } from "@/lib/runtime/background";

// Configured values from environment
const ALGOD_NETWORK = process.env.ALGOD_NETWORK || "testnet";

// Check if blockchain anchoring is explicitly enabled
const BLOCKCHAIN_ENABLED = process.env.BLOCKCHAIN_ENABLED === "true";

export interface WorkflowEventInput {
  workflowId: string;
  taskId?: string;
  eventType: "TASK_ASSIGNED" | "TASK_ACCEPTED" | "RESULT_COMMITTED" | "RESULT_VERIFIED" | "QA_APPROVED" | "QA_REJECTED" | "PAYMENT_SETTLED";
  fromAgentId?: string;
  toAgentId?: string;
  payload: any; // Raw payload data to hash deterministically
}

/**
 * Stringifies a JSON object with keys sorted alphabetically to produce a stable canonical layout.
 */
export function canonicalJsonStringify(obj: any): string {
  const allKeys: string[] = [];
  JSON.stringify(obj, (key, value) => {
    if (key && !allKeys.includes(key)) {
      allKeys.push(key);
    }
    return value;
  });
  allKeys.sort();
  return JSON.stringify(obj, allKeys);
}

/**
 * Helper to compute the SHA-256 hash of a string content.
 */
export function computeSha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Records a workflow milestone's proof hash in the trust registry (awaited,
 * fast) and anchors it on Algorand in the background. The on-chain anchor
 * waits for block confirmation (several seconds, unbounded on a slow node),
 * so it must not block the workflow: callers get the registry record back
 * immediately with status PENDING, and the background job flips it to
 * CONFIRMED or FAILED.
 */
export async function commitWorkflowEvent(input: WorkflowEventInput): Promise<{
  id: string;
  transactionId: string | null;
  status: "CONFIRMED" | "SKIPPED" | "FAILED" | "PENDING";
  payloadHash: string;
}> {
  const canonicalString = canonicalJsonStringify(input.payload);
  const payloadHash = computeSha256(canonicalString);

  if (!BLOCKCHAIN_ENABLED || !isRealAlgorandConfigured()) {
    const record = await db.blockchainWorkflowEvent.create({
      data: {
        workflowId: input.workflowId,
        taskId: input.taskId || null,
        eventType: input.eventType,
        fromAgentId: input.fromAgentId || null,
        toAgentId: input.toAgentId || null,
        payloadHash,
        network: ALGOD_NETWORK,
        status: "SKIPPED",
      },
    });
    return { id: record.id, transactionId: null, status: "SKIPPED", payloadHash };
  }

  const record = await db.blockchainWorkflowEvent.create({
    data: {
      workflowId: input.workflowId,
      taskId: input.taskId || null,
      eventType: input.eventType,
      fromAgentId: input.fromAgentId || null,
      toAgentId: input.toAgentId || null,
      payloadHash,
      network: ALGOD_NETWORK,
      status: "PENDING",
    },
  });
  runInBackground(`algorand anchor ${input.eventType}`, () => anchorRecord(record.id, input, payloadHash), 45_000);
  return { id: record.id, transactionId: null, status: "PENDING", payloadHash };
}

async function anchorRecord(recordId: string, input: WorkflowEventInput, payloadHash: string): Promise<void> {
  try {
    const { txId } = await submitAnchorTransaction({ v: 1, event: input.eventType, workflow: input.workflowId, task: input.taskId || "", hash: payloadHash });
    await db.blockchainWorkflowEvent.update({ where: { id: recordId }, data: { status: "CONFIRMED", transactionId: txId, confirmedAt: new Date() } });
    if (input.taskId) {
      await emitEvent(db, { taskId: input.taskId, actor: input.fromAgentId || "system", eventType: "WORKFLOW_ANCHORED", payload: { eventType: input.eventType, txId, payloadHash } });
    }
  } catch (err: any) {
    console.error(`[Algorand Trust Error] Failed to anchor event: ${err?.message}`);
    await db.blockchainWorkflowEvent
      .update({ where: { id: recordId }, data: { status: "FAILED", failureReason: err?.message || "Unknown transaction error" } })
      .catch(() => {});
  }
}

/**
 * Verifies a result against the proof recorded for it in the trust registry.
 * Checks the exact registry record written for this output (by id) - not
 * "the latest confirmed record for this event type", which for a retried
 * subtask is the previous attempt's proof and reported a false integrity
 * breach. The registry hash is written before anchoring, so this works the
 * same whether the on-chain anchor is pending, confirmed or skipped.
 */
export async function verifyWorkflowEvent(
  recordId: string,
  currentPayload: any
): Promise<{ success: boolean; error?: string; registeredHash?: string; calculatedHash?: string }> {
  try {
    const calculatedHash = computeSha256(canonicalJsonStringify(currentPayload));
    const record = await db.blockchainWorkflowEvent.findUnique({ where: { id: recordId } });
    if (!record) {
      return { success: false, error: "No registered event commitment found for this workflow stage.", calculatedHash };
    }
    if (record.payloadHash !== calculatedHash) {
      await db.securityEvent.create({
        data: {
          taskId: record.taskId,
          type: "INTEGRITY_MISMATCH",
          reason: `SHA-256 mismatch detected for ${record.eventType} in workflow ${record.workflowId}`,
          payload: JSON.stringify({ registeredHash: record.payloadHash, calculatedHash }),
          severity: "HIGH",
        },
      });
      return {
        success: false,
        error: "Integrity validation failed! Data hash does not match the committed proof.",
        registeredHash: record.payloadHash,
        calculatedHash,
      };
    }
    return { success: true, registeredHash: record.payloadHash, calculatedHash };
  } catch (err: any) {
    return { success: false, error: err.message || "Verification routine crashed" };
  }
}
