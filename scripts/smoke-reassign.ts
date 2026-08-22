import { prisma } from "../lib/prisma";
import { resetDatabase } from "../lib/db/reset";
import { runTask } from "../lib/manager/orchestrator";

// qualityThreshold=100 forces every fallback QA attempt to fail (fallback
// score caps at 95), deterministically exercising retry -> reassign -> terminate.
async function main() {
  await resetDatabase();

  const task = await prisma.task.create({
    data: {
      prompt: "A task engineered to always fail QA so we can observe retry/reassign/terminate.",
      budget: 30,
      remainingBudget: 30,
      qualityThreshold: 100,
      status: "CREATED",
    },
  });

  await runTask(task.id);

  const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  console.log("Final task status (expect FAILED):", finalTask.status);

  const events = await prisma.event.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
  const relevant = events.filter((e) =>
    ["AGENT_SELECTED", "WORK_STARTED", "QA_FAILED", "WORKFORCE_CONSTRUCTED", "ESCROW_REFUNDED", "TASK_FAILED"].includes(e.eventType),
  );
  for (const e of relevant) {
    console.log(`  [${e.eventType}]`, JSON.stringify(JSON.parse(e.payload)));
  }

  const reassignEvent = events.find((e) => {
    if (e.eventType !== "WORKFORCE_CONSTRUCTED") return false;
    const p = JSON.parse(e.payload);
    return p.reassigned === true;
  });
  console.assert(Boolean(reassignEvent), "expected a WORKFORCE_CONSTRUCTED event with reassigned:true");
  console.log("Reassignment occurred:", Boolean(reassignEvent));

  const distinctAgents = new Set(
    events.filter((e) => e.eventType === "AGENT_SELECTED").map((e) => (JSON.parse(e.payload) as { agentId: string }).agentId),
  );
  console.log("Distinct agents assigned to the subtask:", [...distinctAgents]);
  console.assert(distinctAgents.size === 2, `expected exactly 2 distinct agents tried, got ${distinctAgents.size}`);

  const escrows = await prisma.agentEscrow.findMany({ where: { taskId: task.id } });
  console.log(
    "Escrow statuses:",
    escrows.map((e) => ({ agentId: e.agentId, amount: e.amount, status: e.status })),
  );
  console.assert(
    escrows.every((e) => e.status === "REFUNDED"),
    "expected all escrows for this failed subtask to end up REFUNDED",
  );

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
