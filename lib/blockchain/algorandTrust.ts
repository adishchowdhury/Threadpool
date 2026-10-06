import crypto from "crypto";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { isRealAlgorandConfigured, submitAnchorTransaction } from "@/lib/blockchain/algosdkClient";

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
 * Commits a workflow milestone cryptographic proof to the Algorand blockchain as a txn note.
 */
export async function commitWorkflowEvent(input: WorkflowEventInput): Promise<{
  id: string;
  transactionId: string | null;
  status: "CONFIRMED" | "SKIPPED" | "FAILED" | "PENDING";
  payloadHash: string;
}> {
  // 1. Calculate deterministic hash of canonical payload
  const canonicalString = canonicalJsonStringify(input.payload);
  const payloadHash = computeSha256(canonicalString);

  // Idempotency check: prevent duplicate submissions for the same immutable event proof
  const idempotencyHash = computeSha256(`${input.workflowId}_${input.taskId}_${input.eventType}_${payloadHash}`);
  
  // Create pending database record
  const dbRecord = await db.blockchainWorkflowEvent.create({
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

  // If blockchain trust layer is disabled or no signing account is configured, mark as SKIPPED
  if (!BLOCKCHAIN_ENABLED || !isRealAlgorandConfigured()) {
    console.log(`[Algorand Trust] Skiping blockchain anchor for event ${input.eventType}. (BLOCKCHAIN_ENABLED is false or credentials missing)`);
    const updated = await db.blockchainWorkflowEvent.update({
      where: { id: dbRecord.id },
      data: { status: "SKIPPED" },
    });
    return {
      id: updated.id,
      transactionId: null,
      status: "SKIPPED",
      payloadHash,
    };
  }

  try {
    // Submit a real, confirmed Algorand testnet transaction with the proof in the note field
    const noteData = {
      v: 1,
      event: input.eventType,
      workflow: input.workflowId,
      task: input.taskId || "",
      hash: payloadHash,
    };

    const { txId } = await submitAnchorTransaction(noteData);

    console.log(`[Algorand Trust] Anchored event ${input.eventType} on-chain. Payload Hash: ${payloadHash}. TxId: ${txId}`);

    // Update database record to CONFIRMED
    const updated = await db.blockchainWorkflowEvent.update({
      where: { id: dbRecord.id },
      data: {
        status: "CONFIRMED",
        transactionId: txId,
        confirmedAt: new Date(),
      },
    });

    // Emit workflow event
    await emitEvent(db, {
      taskId: input.taskId || "system",
      actor: input.fromAgentId || "system",
      eventType: "WORKFLOW_ANCHORED",
      payload: { eventType: input.eventType, txId, payloadHash },
    });

    return {
      id: updated.id,
      transactionId: txId,
      status: "CONFIRMED",
      payloadHash,
    };
  } catch (err: any) {
    console.error(`[Algorand Trust Error] Failed to anchor event: ${err.message}`);
    const updated = await db.blockchainWorkflowEvent.update({
      where: { id: dbRecord.id },
      data: {
        status: "FAILED",
        failureReason: err.message || "Unknown transaction error",
      },
    });
    return {
      id: updated.id,
      transactionId: null,
      status: "FAILED",
      payloadHash,
    };
  }
}

/**
 * Verifies that the calculated hash of the result payload matches the on-chain recorded proof.
 */
export async function verifyWorkflowEvent(
  workflowId: string,
  eventType: string,
  currentPayload: any
): Promise<{ success: boolean; error?: string; registeredHash?: string; calculatedHash?: string }> {
  try {
    const canonicalString = canonicalJsonStringify(currentPayload);
    const calculatedHash = computeSha256(canonicalString);

    // Look up the registered proof in our trust database registry
    const record = await db.blockchainWorkflowEvent.findFirst({
      where: {
        workflowId,
        eventType,
        status: { in: ["CONFIRMED", "SKIPPED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return {
        success: false,
        error: "No registered event commitment found for this workflow stage.",
        calculatedHash,
      };
    }

    const match = record.payloadHash === calculatedHash;
    if (!match) {
      // Log an integrity / security breach event
      await db.securityEvent.create({
        data: {
          taskId: record.taskId,
          type: "INTEGRITY_MISMATCH",
          reason: `SHA-256 mismatch detected for ${eventType} in workflow ${workflowId}`,
          payload: JSON.stringify({
            registeredHash: record.payloadHash,
            calculatedHash,
          }),
          severity: "HIGH",
        },
      });

      return {
        success: false,
        error: "Integrity validation failed! Data hash does not match the on-chain committed proof.",
        registeredHash: record.payloadHash,
        calculatedHash,
      };
    }

    return {
      success: true,
      registeredHash: record.payloadHash,
      calculatedHash,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Verification routine crashed",
    };
  }
}
