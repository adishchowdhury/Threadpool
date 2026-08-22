import { prisma } from "../lib/prisma";
import { resetDatabase } from "../lib/db/reset";
import { runTask, cancelTask } from "../lib/manager/orchestrator";
import { managerWalletId, escrowWalletId } from "../lib/economy/wallets";

async function main() {
  await resetDatabase();

  const task = await prisma.task.create({
    data: {
      prompt: "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.",
      budget: 30,
      remainingBudget: 30,
      status: "CREATED",
    },
  });

  console.log("Running task", task.id);
  await runTask(task.id);

  const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  console.log("Final status:", finalTask.status);
  console.log("Remaining budget:", finalTask.remainingBudget);

  const subtasks = await prisma.subtask.findMany({ where: { taskId: task.id }, orderBy: { sequence: "asc" } });
  for (const s of subtasks) {
    console.log(`  [${s.status}] ${s.type} -> agent=${s.assignedAgentId} attempts=${s.attemptCount} qaScore=${s.qaScore}`);
  }

  const events = await prisma.event.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
  console.log(`Total events emitted: ${events.length}`);
  console.log("Event types:", [...new Set(events.map((e) => e.eventType))].join(", "));

  const manager = await prisma.wallet.findUniqueOrThrow({ where: { id: managerWalletId() } });
  const escrow = await prisma.wallet.findUniqueOrThrow({ where: { id: escrowWalletId() } });
  console.log("Manager wallet:", manager.balance, "Escrow wallet:", escrow.balance);

  const centralLedgerCount = await prisma.centralLedger.count({ where: { taskId: task.id } });
  const agentLedgerCount = await prisma.agentLedger.count({ where: { taskId: task.id } });
  console.log("CentralLedger rows:", centralLedgerCount, "AgentLedger rows:", agentLedgerCount);

  console.assert(finalTask.status === "COMPLETED", "expected task to complete");
  console.assert(escrow.balance === 0, "escrow pool should be fully drained after completion");

  // --- Cancellation smoke test ---
  const task2 = await prisma.task.create({
    data: { prompt: "A task we will cancel mid-flight.", budget: 20, remainingBudget: 20, status: "CREATED" },
  });
  const runPromise = runTask(task2.id);
  // Cancel almost immediately — before the orchestrator likely finishes.
  await new Promise((r) => setTimeout(r, 50));
  const cancelResult = await cancelTask(task2.id);
  console.log("Cancel result:", cancelResult);
  await runPromise.catch(() => {});

  const task2Final = await prisma.task.findUniqueOrThrow({ where: { id: task2.id } });
  console.log("Task2 final status:", task2Final.status);
  const lockedLeftover = await prisma.agentEscrow.count({ where: { taskId: task2.id, status: "LOCKED" } });
  console.assert(lockedLeftover === 0, `expected no LOCKED escrows left after cancel, got ${lockedLeftover}`);
  console.log("Locked escrows remaining after cancel:", lockedLeftover);

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
