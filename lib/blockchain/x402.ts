import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";
import * as eth from "@/lib/blockchain/ethereum";
import * as algo from "@/lib/blockchain/algorand";

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

export function encodeHeaderPayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodeHeaderPayload<T>(encoded: string): T {
  try {
    const jsonStr = Buffer.from(encoded, "base64").toString("utf-8");
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error(`Failed to decode x402 header: ${err}`);
  }
}

function getProvider() {
  return process.env.BLOCKCHAIN_PROVIDER === "algorand" ? "algorand" : "ethereum";
}

/**
 * The deterministic backend Payment Guard and Circuit Breaker for x402 requests.
 * Supports both Ethereum Sepolia and Algorand Testnet.
 */
export async function executeX402PaymentGuard(params: {
  taskId: string;
  requestingAgentId: string;
  recipientServiceId: string;
  amount: number; // in tokens/Wei/microAlgos
  purpose: string;
  idempotencyKey: string;
}): Promise<
  | { decision: "APPROVE"; txId: string; network: string }
  | { decision: "BLOCK"; reason: string }
> {
  const provider = getProvider();
  const MAX_TRANSACTION_LIMIT = 5000;
  // Premium services quote in Wei/microAlgos (see premium-market-research route);
  // the task's remainingBudget is denominated in whole virtual tokens. 1000
  // Wei/microAlgo == 1 token is the fixed demo exchange rate — convert before
  // comparing against or debiting the token budget.
  const TOKEN_UNIT = 1000;
  const tokenCost = params.amount / TOKEN_UNIT;

  return prisma.$transaction(async (db) => {
    // 1. Fetch Task
    const task = await db.task.findUniqueOrThrow({ where: { id: params.taskId } });

    // 2. Deterministic spending rule checks
    let blockedReason = "";
    if (params.amount > MAX_TRANSACTION_LIMIT) {
      blockedReason = "EXCEEDS_MAX_TRANSACTION_LIMIT";
    } else if (tokenCost > task.remainingBudget) {
      blockedReason = "BUDGET_EXCEEDED";
    }

    if (blockedReason) {
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
          network: existingIntent.network || (provider === "algorand" ? "testnet" : "sepolia"),
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
        currency: provider === "algorand" ? "ALGO" : "ETH",
        status: "PENDING",
        idempotencyKey: params.idempotencyKey,
      },
    });

    // 4. Submit Payment
    try {
      let txId = "";
      let network = "";
      let rawMetadata = "";

      if (provider === "algorand") {
        const payment = await algo.sendAlgorandPayment(
          params.taskId,
          params.requestingAgentId,
          params.amount,
          algo.getManagerAddress(),
          params.purpose
        );
        txId = payment.txId;
        network = payment.network;
        rawMetadata = JSON.stringify({ note: "Algorand micro-payment" });
      } else {
        const payment = await eth.sendEthereumPayment(
          params.taskId,
          params.requestingAgentId,
          params.amount,
          eth.getManagerAddress(),
          params.purpose
        );
        txId = payment.txId;
        network = payment.network;

        // Optionally anchor the transaction hash to a registry contract (not deployed for this project)
        const anchor = await eth.anchorTransactionHash(payment.txId);
        rawMetadata = anchor.success
          ? JSON.stringify({
              anchorTxHash: anchor.anchorTxHash,
              contractAddress: anchor.contractAddress,
              anchoredAt: new Date().toISOString(),
            })
          : JSON.stringify({});
      }

      // Create BlockchainTransaction record
      await db.blockchainTransaction.create({
        data: {
          paymentIntentId: intent.id,
          network: network,
          transactionId: txId,
          amount: params.amount,
          asset: provider === "algorand" ? "ALGO" : "ETH",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          rawMetadata,
        },
      });

      // Update PaymentIntent to Settled
      await db.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "SETTLED",
          blockchainTxId: txId,
          network: network,
          settledAt: new Date(),
        },
      });

      // Deduct from task budget (token-equivalent, not raw Wei/microAlgos)
      await db.task.update({
        where: { id: params.taskId },
        data: { remainingBudget: { decrement: Math.round(tokenCost) } },
      });

      // Emit event
      await emitEvent(db, {
        taskId: params.taskId,
        actor: "system",
        eventType: "TRANSACTION_APPROVED",
        payload: {
          agentId: params.requestingAgentId,
          amount: params.amount,
          txId: txId,
        },
      });

      return {
        decision: "APPROVE" as const,
        txId: txId,
        network: network,
      };
    } catch (err: any) {
      await db.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: "FAILED",
          failureReason: err.message || `${provider} payment execution failed`,
        },
      });
      return { decision: "BLOCK" as const, reason: "BLOCKCHAIN_PAYMENT_FAILED" };
    }
  });
}
