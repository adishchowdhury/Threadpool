import { prisma } from "../lib/prisma";
import { resetDatabase } from "../lib/db/reset";
import { managerWalletId, escrowWalletId } from "../lib/economy/wallets";
import { lockAgentEscrow, releaseAgentEscrow, refundAgentEscrow } from "../lib/economy/escrow";

async function balances() {
  const manager = await prisma.wallet.findUniqueOrThrow({ where: { id: managerWalletId() } });
  const escrow = await prisma.wallet.findUniqueOrThrow({ where: { id: escrowWalletId() } });
  return { manager: manager.balance, escrow: escrow.balance };
}

async function main() {
  await resetDatabase();
  const before = await balances();
  console.log("Initial:", before);

  const task = await prisma.task.create({
    data: { prompt: "Smoke test task", budget: 15, remainingBudget: 15, status: "IN_PROGRESS" },
  });

  const subtaskWriter = await prisma.subtask.create({
    data: { taskId: task.id, type: "writing", requiredCapability: "writing", assignedAgentId: "writer-01" },
  });
  const subtaskResearch = await prisma.subtask.create({
    data: { taskId: task.id, type: "research", requiredCapability: "market_research", assignedAgentId: "researcher-01" },
  });

  // 1. Lock 8 for writer-01
  const lock1 = await lockAgentEscrow({ taskId: task.id, subtaskId: subtaskWriter.id, agentId: "writer-01", amount: 8, purpose: "writing" });
  console.log("Lock writer 8:", lock1.blocked ? lock1.reason : "OK");
  console.assert(!lock1.blocked, "expected legit lock to succeed");

  const afterLock = await balances();
  console.log("After lock 8:", afterLock);
  console.assert(afterLock.manager === before.manager - 8, "manager wallet should be down 8");
  console.assert(afterLock.escrow === before.escrow + 8, "escrow wallet should be up 8");

  const taskAfterLock = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  console.assert(taskAfterLock.remainingBudget === 7, `remainingBudget should be 7, got ${taskAfterLock.remainingBudget}`);

  // 2. Release the writer's escrow after QA pass (legit amount = locked amount)
  if (!lock1.blocked) {
    const release1 = await releaseAgentEscrow({ agentEscrowId: lock1.agentEscrow.id, requestedAmount: 8, purpose: "writing" });
    console.log("Release writer 8:", release1.blocked ? release1.reason : "OK");
    console.assert(!release1.blocked, "expected legit release to succeed");
  }

  const afterRelease = await balances();
  console.log("After release:", afterRelease);
  const writerWallet = await prisma.wallet.findUniqueOrThrow({ where: { agentId: "writer-01" } });
  console.assert(writerWallet.balance === 8, `writer wallet should be 8, got ${writerWallet.balance}`);

  // 3. Lock 4 for researcher-01, then refund it (simulating cancellation)
  const lock2 = await lockAgentEscrow({ taskId: task.id, subtaskId: subtaskResearch.id, agentId: "researcher-01", amount: 4, purpose: "market_research" });
  console.assert(!lock2.blocked, "expected 2nd legit lock to succeed");
  if (!lock2.blocked) {
    const refund = await refundAgentEscrow({ agentEscrowId: lock2.agentEscrow.id, reason: "task_cancelled" });
    console.log("Refund researcher 4:", refund.refunded ? "OK" : refund.reason);
    console.assert(refund.refunded, "expected refund to succeed");
  }

  const taskAfterRefund = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  console.assert(taskAfterRefund.remainingBudget === 7, `remainingBudget should return to 7, got ${taskAfterRefund.remainingBudget}`);

  // 4. Rogue agent demo: hard task budget = 15, remaining = 7 now. Rogue requests 10,000.
  const rogueTask = await prisma.task.create({
    data: { prompt: "Rogue demo task", budget: 15, remainingBudget: 15, status: "IN_PROGRESS" },
  });
  const rogueSubtask = await prisma.subtask.create({
    data: { taskId: rogueTask.id, type: "rogue", requiredCapability: "unbounded_payment_request", assignedAgentId: "rogue-agent" },
  });
  const rogueLock = await lockAgentEscrow({ taskId: rogueTask.id, subtaskId: rogueSubtask.id, agentId: "rogue-agent", amount: 8, purpose: "market_research" });
  console.assert(!rogueLock.blocked, "rogue's initial legit-looking lock of 8 should succeed");

  const beforeRogue = await balances();
  if (!rogueLock.blocked) {
    const rogueRelease = await releaseAgentEscrow({ agentEscrowId: rogueLock.agentEscrow.id, requestedAmount: 10000, purpose: "market_research" });
    console.log("Rogue payout request for 10,000:", rogueRelease.blocked ? `BLOCKED (${rogueRelease.reason})` : "APPROVED (BUG!)");
    console.assert(rogueRelease.blocked, "rogue payout of 10,000 against budget 15 MUST be blocked");
  }
  const afterRogue = await balances();
  console.assert(afterRogue.manager === beforeRogue.manager && afterRogue.escrow === beforeRogue.escrow, "rogue block must not move any balance");
  console.log("Balances unchanged after rogue block:", afterRogue.manager === beforeRogue.manager && afterRogue.escrow === beforeRogue.escrow);

  const rogueAgent = await prisma.agent.findUniqueOrThrow({ where: { id: "rogue-agent" } });
  console.log("Rogue agent status after block:", rogueAgent.status);

  const securityEvents = await prisma.securityEvent.findMany({ where: { taskId: rogueTask.id } });
  console.log("Security events logged for rogue task:", securityEvents.length);

  console.log("\nSMOKE TEST COMPLETE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
