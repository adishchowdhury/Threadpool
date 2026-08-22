import type { Prisma, TxStatus, TxType } from "@/app/generated/prisma/client";

interface LedgerPairInput {
  taskId: string;
  agentId?: string | null;
  subtaskId?: string | null;
  agentEscrowId?: string | null;
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  purpose: string;
  type: TxType;
  status: TxStatus;
  reason?: string | null;
}

// Writes the same transaction into BOTH the global CentralLedger (the
// system-wide audit trail) and, when an agent is involved, that agent's
// AgentLedger sub-ledger — so every agent gets an isolated statement of its
// own dealings with the Manager without scanning the whole ledger.
export async function writeLedgerPair(db: Prisma.TransactionClient, input: LedgerPairInput) {
  const central = await db.centralLedger.create({
    data: {
      taskId: input.taskId,
      agentEscrowId: input.agentEscrowId ?? null,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      amount: input.amount,
      purpose: input.purpose,
      type: input.type,
      status: input.status,
      reason: input.reason ?? null,
    },
  });

  let agentLedger = null;
  if (input.agentId) {
    agentLedger = await db.agentLedger.create({
      data: {
        agentId: input.agentId,
        taskId: input.taskId,
        subtaskId: input.subtaskId ?? null,
        agentEscrowId: input.agentEscrowId ?? null,
        centralLedgerId: central.id,
        direction: input.type,
        amount: input.amount,
        purpose: input.purpose,
        type: input.type,
        status: input.status,
        reason: input.reason ?? null,
      },
    });
  }

  return { central, agentLedger };
}
