import { db } from "@/lib/db/client";
import { writeLedgerPair } from "@/lib/economy/ledger";
import { evaluateTransaction, isSevereViolation } from "@/lib/economy/circuitBreaker";
import { managerWalletId, escrowWalletId } from "@/lib/economy/wallets";
import { generateMockAlgorandAddress } from "@/lib/blockchain/algorand";
import * as algo from "@/lib/blockchain/algorand";
import { emitEvent } from "@/lib/events/emit";
import type { DbClient } from "@/lib/db/client";
import type { TxType } from "@/lib/db/types";

// Mirrors a just-written internal ledger transfer onto Algorand testnet so
// every wallet-to-wallet payment (escrow lock, agent payout, refund) has a
// corresponding on-chain transaction. Never blocks or reverses the internal
// transfer - a mirror failure is logged and swallowed, since the ledger is
// the source of truth per CLAUDE.md.
//
// Deliberately called with the plain `db` client AFTER the enclosing
// db.$transaction has committed, never with its TransactionClient: a real
// on-chain submission waits several seconds for confirmation, which would
// hold the financial transaction's row locks open for far too long.
async function mirrorLedgerToAlgorand(
  db: DbClient,
  params: {
    taskId: string;
    centralLedgerId: string;
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    purpose: string;
    type: TxType;
  },
) {
  try {
    const [fromWallet, toWallet] = await Promise.all([
      db.wallet.findUniqueOrThrow({ where: { id: params.fromWalletId } }),
      db.wallet.findUniqueOrThrow({ where: { id: params.toWalletId } }),
    ]);
    const fromAddress = fromWallet.algorandAddress ?? generateMockAlgorandAddress(params.fromWalletId);
    const toAddress = toWallet.algorandAddress ?? generateMockAlgorandAddress(params.toWalletId);

    const mirrored = await algo.mirrorTransaction({
      fromAddress,
      toAddress,
      amountMicroAlgos: params.amount,
      purpose: params.purpose,
    });

    await db.algorandLedgerTransaction.create({
      data: {
        taskId: params.taskId,
        centralLedgerId: params.centralLedgerId,
        fromWalletId: params.fromWalletId,
        toWalletId: params.toWalletId,
        fromAddress,
        toAddress,
        amount: params.amount,
        purpose: params.purpose,
        type: params.type,
        txId: mirrored.txId,
        network: mirrored.network,
        status: mirrored.status,
      },
    });
  } catch (err) {
    console.error("[Algorand Mirror] failed to mirror ledger transaction", err);
  }
}

async function getOrCreateCentralEscrow(db: DbClient, taskId: string) {
  const existing = await db.centralEscrow.findUnique({ where: { taskId } });
  if (existing) return existing;
  return db.centralEscrow.create({ data: { taskId, totalLocked: 0, totalReleased: 0, totalRefunded: 0 } });
}

async function recordBlocked(
  db: DbClient,
  params: {
    taskId: string;
    agentId: string;
    subtaskId?: string | null;
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    purpose: string;
    reason: string;
    remainingBudget: number;
  },
) {
  await writeLedgerPair(db, {
    taskId: params.taskId,
    agentId: params.agentId,
    subtaskId: params.subtaskId,
    fromWalletId: params.fromWalletId,
    toWalletId: params.toWalletId,
    amount: params.amount,
    purpose: params.purpose,
    type: "BLOCKED_ATTEMPT",
    status: "BLOCKED",
    reason: params.reason,
  });

  await db.securityEvent.create({
    data: {
      taskId: params.taskId,
      agentId: params.agentId,
      type: "CIRCUIT_BREAKER_BLOCK",
      reason: params.reason,
      payload: JSON.stringify({ amount: params.amount, purpose: params.purpose }),
      requestedAmount: params.amount,
      allowedAmount: params.remainingBudget,
      severity: isSevereViolation(params.amount, params.remainingBudget) ? "CRITICAL" : "HIGH",
    },
  });

  await emitEvent(db, {
    taskId: params.taskId,
    actor: "circuit_breaker",
    eventType: "TRANSACTION_BLOCKED",
    payload: { agentId: params.agentId, amount: params.amount, reason: params.reason },
  });

  let revoked = false;
  if (isSevereViolation(params.amount, params.remainingBudget)) {
    await db.agent.update({ where: { id: params.agentId }, data: { status: "REVOKED" } });
    await emitEvent(db, {
      taskId: params.taskId,
      actor: "circuit_breaker",
      eventType: "WALLET_REVOKED",
      payload: { agentId: params.agentId, reason: "severe policy violation" },
    });
    revoked = true;
  }

  return revoked;
}

// Locks funds out of the central task-level pool into a per-subtask,
// per-agent escrow. Gated by the Circuit Breaker before any balance moves.
export async function lockAgentEscrow(params: {
  taskId: string;
  subtaskId: string;
  agentId: string;
  amount: number;
  purpose: string;
}) {
  return db.$transaction(async (db) => {
    // Sequential on purpose: MongoDB sessions don't support parallel
    // operations inside one transaction.
    const task = await db.task.findUniqueOrThrow({ where: { id: params.taskId } });
    const agent = await db.agent.findUniqueOrThrow({ where: { id: params.agentId } });

    const decision = evaluateTransaction({
      amount: params.amount,
      purpose: params.purpose,
      taskRemainingBudget: task.remainingBudget,
      agentStatus: agent.status,
      escrowAvailable: task.remainingBudget, // lock-time ceiling is the task pool itself
    });

    if (decision.decision === "BLOCK") {
      const revoked = await recordBlocked(db, {
        taskId: params.taskId,
        agentId: params.agentId,
        subtaskId: params.subtaskId,
        fromWalletId: managerWalletId(),
        toWalletId: escrowWalletId(),
        amount: params.amount,
        purpose: params.purpose,
        reason: decision.reason,
        remainingBudget: task.remainingBudget,
      });
      return { blocked: true as const, reason: decision.reason, revoked };
    }

    await db.wallet.update({ where: { id: managerWalletId() }, data: { balance: { decrement: params.amount } } });
    await db.wallet.update({ where: { id: escrowWalletId() }, data: { balance: { increment: params.amount } } });
    await db.task.update({ where: { id: params.taskId }, data: { remainingBudget: { decrement: params.amount } } });

    const central = await getOrCreateCentralEscrow(db, params.taskId);
    await db.centralEscrow.update({
      where: { id: central.id },
      data: { totalLocked: { increment: params.amount } },
    });

    const agentEscrow = await db.agentEscrow.create({
      data: {
        taskId: params.taskId,
        subtaskId: params.subtaskId,
        agentId: params.agentId,
        amount: params.amount,
        status: "LOCKED",
      },
    });

    const { central: lockLedger } = await writeLedgerPair(db, {
      taskId: params.taskId,
      agentId: params.agentId,
      subtaskId: params.subtaskId,
      agentEscrowId: agentEscrow.id,
      fromWalletId: managerWalletId(),
      toWalletId: escrowWalletId(),
      amount: params.amount,
      purpose: params.purpose,
      type: "LOCK",
      status: "APPROVED",
    });

    await emitEvent(db, {
      taskId: params.taskId,
      actor: "manager",
      eventType: "ESCROW_LOCKED",
      payload: { agentId: params.agentId, subtaskId: params.subtaskId, amount: params.amount },
    });

    return { blocked: false as const, agentEscrow, lockLedgerId: lockLedger.id };
  }).then(async (result) => {
    if (!result.blocked) {
      await mirrorLedgerToAlgorand(db, {
        taskId: params.taskId,
        centralLedgerId: result.lockLedgerId,
        fromWalletId: managerWalletId(),
        toWalletId: escrowWalletId(),
        amount: params.amount,
        purpose: params.purpose,
        type: "LOCK",
      });
    }
    return result;
  });
}

// Releases a locked escrow to the agent's wallet - ONLY call after QA has
// passed. `requestedAmount` is separate from the escrow's locked amount so a
// rogue/inflated payout request can be modeled and blocked realistically;
// legitimate callers always pass the exact locked amount.
export async function releaseAgentEscrow(params: {
  agentEscrowId: string;
  requestedAmount: number;
  purpose: string;
}) {
  return db.$transaction(async (db) => {
    const agentEscrow = await db.agentEscrow.findUniqueOrThrow({ where: { id: params.agentEscrowId } });
    const task = await db.task.findUniqueOrThrow({ where: { id: agentEscrow.taskId } });
    const agent = await db.agent.findUniqueOrThrow({ where: { id: agentEscrow.agentId } });
    const agentWallet = await db.wallet.upsert({
      where: { agentId: agent.id },
      update: {},
      create: { type: "AGENT", agentId: agent.id, balance: 0, algorandAddress: generateMockAlgorandAddress(`agent:${agent.id}`) },
    });

    await emitEvent(db, {
      taskId: task.id,
      actor: agent.id,
      eventType: "PAYOUT_REQUESTED",
      payload: { agentId: agent.id, amount: params.requestedAmount, subtaskId: agentEscrow.subtaskId },
    });

    if (agentEscrow.status !== "LOCKED") {
      const decision = { decision: "BLOCK" as const, reason: `escrow already ${agentEscrow.status.toLowerCase()}` };
      const revoked = await recordBlocked(db, {
        taskId: task.id,
        agentId: agent.id,
        subtaskId: agentEscrow.subtaskId,
        fromWalletId: escrowWalletId(),
        toWalletId: agentWallet.id,
        amount: params.requestedAmount,
        purpose: params.purpose,
        reason: decision.reason,
        remainingBudget: task.budget,
      });
      return { blocked: true as const, reason: decision.reason, revoked };
    }

    // Hard ceiling uses the ORIGINAL task budget (never exceeded regardless
    // of what any agent requests), while escrowAvailable is the real limit
    // for a legitimate release: exactly what was locked for this subtask.
    const decision = evaluateTransaction({
      amount: params.requestedAmount,
      purpose: params.purpose,
      taskRemainingBudget: task.budget,
      agentStatus: agent.status,
      escrowAvailable: agentEscrow.amount,
    });

    if (decision.decision === "BLOCK") {
      const revoked = await recordBlocked(db, {
        taskId: task.id,
        agentId: agent.id,
        subtaskId: agentEscrow.subtaskId,
        fromWalletId: escrowWalletId(),
        toWalletId: agentWallet.id,
        amount: params.requestedAmount,
        purpose: params.purpose,
        reason: decision.reason,
        remainingBudget: task.budget,
      });
      return { blocked: true as const, reason: decision.reason, revoked };
    }

    // Atomic claim before any balance moves - an escrow can be settled once
    // (released OR refunded), even when two operations race without
    // transaction isolation. See refundAgentEscrow.
    const claim = await db.agentEscrow.updateMany({ where: { id: agentEscrow.id, status: "LOCKED" }, data: { status: "RELEASED" } });
    if (claim.count === 0) {
      return { blocked: true as const, reason: "escrow already settled by a concurrent operation", revoked: false };
    }

    await db.wallet.update({ where: { id: escrowWalletId() }, data: { balance: { decrement: params.requestedAmount } } });
    await db.wallet.update({ where: { id: agentWallet.id }, data: { balance: { increment: params.requestedAmount } } });

    const central = await getOrCreateCentralEscrow(db, task.id);
    await db.centralEscrow.update({
      where: { id: central.id },
      data: { totalLocked: { decrement: agentEscrow.amount }, totalReleased: { increment: params.requestedAmount } },
    });

    const { central: payoutLedger } = await writeLedgerPair(db, {
      taskId: task.id,
      agentId: agent.id,
      subtaskId: agentEscrow.subtaskId,
      agentEscrowId: agentEscrow.id,
      fromWalletId: escrowWalletId(),
      toWalletId: agentWallet.id,
      amount: params.requestedAmount,
      purpose: params.purpose,
      type: "PAYOUT",
      status: "APPROVED",
    });

    await emitEvent(db, {
      taskId: task.id,
      actor: "circuit_breaker",
      eventType: "TRANSACTION_APPROVED",
      payload: { agentId: agent.id, amount: params.requestedAmount, subtaskId: agentEscrow.subtaskId },
    });

    return { blocked: false as const, agentWallet, payoutLedgerId: payoutLedger.id, taskId: task.id };
  }).then(async (result) => {
    if (!result.blocked) {
      await mirrorLedgerToAlgorand(db, {
        taskId: result.taskId,
        centralLedgerId: result.payoutLedgerId,
        fromWalletId: escrowWalletId(),
        toWalletId: result.agentWallet.id,
        amount: params.requestedAmount,
        purpose: params.purpose,
        type: "PAYOUT",
      });
    }
    return result;
  });
}

// Returns locked funds to the manager wallet - used on cancellation or when
// a subtask is permanently terminated after exhausting retries.
export async function refundAgentEscrow(params: { agentEscrowId: string; reason: string }) {
  return db.$transaction(async (db) => {
    const agentEscrow = await db.agentEscrow.findUniqueOrThrow({ where: { id: params.agentEscrowId } });
    if (agentEscrow.status !== "LOCKED") {
      return { refunded: false as const, reason: `escrow already ${agentEscrow.status.toLowerCase()}` };
    }

    // Claim the escrow with an atomic compare-and-set BEFORE moving money.
    // The status check above is only a fast path: without replica-set
    // transactions two concurrent callers (e.g. a double-clicked cancel) both
    // saw LOCKED and refunded twice. Only the caller whose conditional update
    // matches may proceed.
    const claim = await db.agentEscrow.updateMany({ where: { id: agentEscrow.id, status: "LOCKED" }, data: { status: "REFUNDED" } });
    if (claim.count === 0) {
      return { refunded: false as const, reason: "escrow already settled by a concurrent operation" };
    }

    await db.wallet.update({ where: { id: escrowWalletId() }, data: { balance: { decrement: agentEscrow.amount } } });
    await db.wallet.update({ where: { id: managerWalletId() }, data: { balance: { increment: agentEscrow.amount } } });
    await db.task.update({ where: { id: agentEscrow.taskId }, data: { remainingBudget: { increment: agentEscrow.amount } } });

    const central = await getOrCreateCentralEscrow(db, agentEscrow.taskId);
    await db.centralEscrow.update({
      where: { id: central.id },
      data: { totalLocked: { decrement: agentEscrow.amount }, totalRefunded: { increment: agentEscrow.amount } },
    });

    const { central: refundLedger } = await writeLedgerPair(db, {
      taskId: agentEscrow.taskId,
      agentId: agentEscrow.agentId,
      subtaskId: agentEscrow.subtaskId,
      agentEscrowId: agentEscrow.id,
      fromWalletId: escrowWalletId(),
      toWalletId: managerWalletId(),
      amount: agentEscrow.amount,
      purpose: params.reason,
      type: "REFUND",
      status: "APPROVED",
      reason: params.reason,
    });

    await emitEvent(db, {
      taskId: agentEscrow.taskId,
      actor: "system",
      eventType: "ESCROW_REFUNDED",
      payload: { agentId: agentEscrow.agentId, subtaskId: agentEscrow.subtaskId, amount: agentEscrow.amount, reason: params.reason },
    });

    return { refunded: true as const, refundLedgerId: refundLedger.id, taskId: agentEscrow.taskId, amount: agentEscrow.amount };
  }).then(async (result) => {
    if (result.refunded) {
      await mirrorLedgerToAlgorand(db, {
        taskId: result.taskId,
        centralLedgerId: result.refundLedgerId,
        fromWalletId: escrowWalletId(),
        toWalletId: managerWalletId(),
        amount: result.amount,
        purpose: params.reason,
        type: "REFUND",
      });
    }
    return result;
  });
}
