import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";
import { getManagerAddress, sendEthereumPayment, verifyEthereumTransaction, anchorTransactionHash } from "@/lib/blockchain/ethereum";

export interface PaymentRequiredPayload {
  x402Version: number;
  error: string;
  resource: {
    url: string;
    description: string;
  };
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
  }>;
}

export interface PaymentSignaturePayload {
  network: string;
  transaction: string;
}

export interface PaymentResponsePayload {
  success: boolean;
  network: string;
  transaction: string;
}

/**
 * Encodes a JSON payload into a Base64 string for x402 headers.
 */
export function encodeHeaderPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Decodes a Base64 string from x402 headers back into a JSON object.
 */
export function decodeHeaderPayload<T>(encoded: string): T {
  try {
    const jsonStr = Buffer.from(encoded, "base64").toString("utf-8");
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error(`Failed to decode x402 header: ${err}`);
  }
}

/**
 * The deterministic backend Payment Guard and Circuit Breaker for x402 requests.
 * Evaluates spending limits, checks budgets, records security events if limits are exceeded,
 * and executes payment on Ethereum Sepolia.
 */
export async function executeX402PaymentGuard(params: {
  taskId: string;
  requestingAgentId: string;
  recipientServiceId: string;
  amount: number; // in tokens/Wei equivalent
  purpose: string;
  idempotencyKey: string;
}): Promise<
  | { decision: "APPROVE"; txId: string; network: string }
  | { decision: "BLOCK"; reason: string }
> {
  const MAX_TRANSACTION_LIMIT = 5000; // e.g. 5,000 Wei / 5.00 tokens limit

  return prisma.$transaction(async (db) => {
    // 1. Fetch Task
    const task = await db.task.findUniqueOrThrow({ where: { id: params.taskId } });

    // 2. Deterministic spending rule checks
    let blockedReason = "";
    if (params.amount > MAX_TRANSACTION_LIMIT) {
      blockedReason = "EXCEEDS_MAX_TRANSACTION_LIMIT";
    } else if (params.amount > task.remainingBudget) {
      blockedReason = "BUDGET_EXCEEDED";
    }

    if (blockedReason) {
      // Create SecurityEvent in the DB
      await db.securityEvent.create({
        data: {
          taskId: params.taskId,
          agentId: params.requestingAgentId,
          type: "CIRCUIT_BREAKER_TRIGGERED",
          reason: blockedReason,
          payload: JSON.stringify({
            amount: params.amount,
            allowedLimit: MAX_TRANSACTION_LIMIT,
            recipient: params.recipientServiceId,
          }),
          severity: "CRITICAL",
          requestedAmount: params.amount,
          allowedAmount: MAX_TRANSACTION_LIMIT,
        },
      });

      // Write transaction as BLOCKED in the ledger to maintain internal balance audits
      await db.centralLedger.create({
        data: {
          taskId: params.taskId,
          fromWalletId: "wallet-manager",
          toWalletId: "wallet-escrow-pool",
          amount: Math.round(params.amount),
          purpose: params.purpose,
          type: "BLOCKED_ATTEMPT",
          status: "BLOCKED",
          reason: blockedReason,
        },
      });

      // Emit realtime events to alert UI/Activity feed
      await emitEvent(db, {
        taskId: params.taskId,
        actor: "circuit_breaker",
        eventType: "TRANSACTION_BLOCKED",
        payload: {
          agentId: params.requestingAgentId,
          amount: params.amount,
          reason: blockedReason,
        },
      });

      return { decision: "BLOCK" as const, reason: blockedReason };
    }

    // 3. Create PaymentIntent record (Pending state to prevent double execution)
    const existingIntent = await db.paymentIntent.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existingIntent) {
      if (existingIntent.status === "SETTLED" && existingIntent.blockchainTxId) {
        return {
          decision: "APPROVE" as const,
          txId: existingIntent.blockchainTxId,
          network: existingIntent.network || "sepolia",
        };
      }
      return { decision: "BLOCK" as const, reason: "DUPLICATE_IDEMPOTENCY_KEY" };
    }

    const intent = await db.paymentIntent.create({
      data: {
        taskId: params.taskId,
        requestingAgentId: params.requestingAgentId,
        recipientServiceId: params.recipientServiceId,
        amount: params.amount,
        currency: "ETH",
        status: "PENDING",
        idempotencyKey: params.idempotencyKey,
      },
    });

    // 4. Submit Ethereum Payment
    try {
      const payment = await sendEthereumPayment(
        params.taskId,
        params.requestingAgentId,
        params.amount,
        getManagerAddress(),
        params.purpose
      );

      // Anchor the transaction hash to the Ethereum Sepolia contract
      const anchor = await anchorTransactionHash(payment.txId);

      // Create BlockchainTransaction record
      await db.blockchainTransaction.create({
        data: {
          paymentIntentId: intent.id,
          network: payment.network,
          transactionId: payment.txId,
          amount: params.amount,
          asset: "ETH",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          rawMetadata: JSON.stringify({
            anchorTxHash: anchor.anchorTxHash,
            contractAddress: anchor.contractAddress,
            anchoredAt: new Date().toISOString(),
          }),
        },
      });

      // Update PaymentIntent to Settled
      await db.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "SETTLED",
          blockchainTxId: payment.txId,
          network: payment.network,
          settledAt: new Date(),
        },
      });

      // Deduct from task budget
      await db.task.update({
        where: { id: params.taskId },
        data: { remainingBudget: { decrement: Math.round(params.amount) } },
      });

      // Emit event
      await emitEvent(db, {
        taskId: params.taskId,
        actor: "system",
        eventType: "TRANSACTION_APPROVED",
        payload: {
          agentId: params.requestingAgentId,
          amount: params.amount,
          txId: payment.txId,
        },
      });

      return {
        decision: "APPROVE" as const,
        txId: payment.txId,
        network: payment.network,
      };
    } catch (err: any) {
      await db.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "FAILED",
          failureReason: err.message || "Ethereum payment execution failed",
        },
      });
      return { decision: "BLOCK" as const, reason: "BLOCKCHAIN_PAYMENT_FAILED" };
    }
  });
}
