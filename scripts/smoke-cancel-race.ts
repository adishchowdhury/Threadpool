import { prisma } from "../lib/prisma";
import { resetDatabase } from "../lib/db/reset";
import { runTask, cancelTask } from "../lib/manager/orchestrator";

// Repeatedly races cancelTask() against a running orchestration to catch the
// "escrow locked after the cancel refund sweep already ran" leak.
async function runOnce(i: number) {
  const task = await prisma.task.create({
    data: { prompt: `Race test #${i}`, budget: 30, remainingBudget: 30, status: "CREATED" },
  });
  const runPromise = runTask(task.id).catch(() => {});
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 40)));
  await cancelTask(task.id).catch(() => {});
  await runPromise;

  const leaked = await prisma.agentEscrow.count({ where: { taskId: task.id, status: "LOCKED" } });
  const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  return { leaked, status: finalTask.status };
}

async function main() {
  await resetDatabase();
  let totalLeaked = 0;
  const statuses: Record<string, number> = {};

  for (let i = 0; i < 15; i++) {
    const { leaked, status } = await runOnce(i);
    totalLeaked += leaked;
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (leaked > 0) console.log(`Run ${i}: LEAKED ${leaked} escrow(s), status=${status}`);
  }

  console.log("Status distribution:", statuses);
  console.log("Total leaked LOCKED escrows across all runs:", totalLeaked);
  console.assert(totalLeaked === 0, "expected zero leaked escrows across all racing runs");
  console.log(totalLeaked === 0 ? "\nSMOKE TEST COMPLETE — no leaks" : "\nSMOKE TEST FAILED — leaks found");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
