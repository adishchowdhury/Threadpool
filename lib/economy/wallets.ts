import { prisma } from "@/lib/prisma";

// Two singleton system wallets:
//  - MANAGER: funds every task's budget.
//  - ESCROW:  holding wallet for all locked-but-not-yet-released funds
//             (both the central task-level pool and per-agent sub-allocations
//             pass through this single holding wallet; which pool/agent a
//             given lock belongs to is tracked by CentralEscrow/AgentEscrow
//             rows, not by separate wallets).
const MANAGER_WALLET_ID = "wallet-manager";
const ESCROW_WALLET_ID = "wallet-escrow-pool";
const MANAGER_STARTING_BALANCE = 1_000_000; // hackathon sandbox — effectively unbounded top-up source

export async function ensureSystemWallets() {
  await prisma.wallet.upsert({
    where: { id: MANAGER_WALLET_ID },
    update: {},
    create: { id: MANAGER_WALLET_ID, type: "MANAGER", balance: MANAGER_STARTING_BALANCE },
  });
  await prisma.wallet.upsert({
    where: { id: ESCROW_WALLET_ID },
    update: {},
    create: { id: ESCROW_WALLET_ID, type: "USER", balance: 0 },
  });
}

export function managerWalletId() {
  return MANAGER_WALLET_ID;
}

export function escrowWalletId() {
  return ESCROW_WALLET_ID;
}

export async function ensureAgentWallet(agentId: string) {
  const existing = await prisma.wallet.findUnique({ where: { agentId } });
  if (existing) return existing;
  return prisma.wallet.create({
    data: { type: "AGENT", agentId, balance: 0 },
  });
}
