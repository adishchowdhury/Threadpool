import { prisma } from "../lib/prisma";
import { resetDatabase } from "../lib/db/reset";
import { decomposeTask } from "../lib/manager/planner";
import { runTask } from "../lib/manager/orchestrator";

async function main() {
  console.log("--- Testing decomposeTask (generateObject) ---");
  const { plan, source } = await decomposeTask({
    prompt: "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.",
    budget: 30,
  });
  console.log("Source:", source);
  console.assert(source === "gemini", "expected planner to use gemini, not fallback");
  console.log("Subtasks:", plan.subtasks.map((s) => `${s.type} (${s.requiredCapability})`));

  console.log("\n--- Running full task live against Gemini ---");
  await resetDatabase();
  const task = await prisma.task.create({
    data: {
      prompt: "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.",
      budget: 30,
      remainingBudget: 30,
      status: "CREATED",
    },
  });
  const start = Date.now();
  await runTask(task.id);
  console.log(`Completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  const finalTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  console.log("Final status:", finalTask.status);

  const subtasks = await prisma.subtask.findMany({ where: { taskId: task.id }, orderBy: { sequence: "asc" } });
  for (const s of subtasks) {
    console.log(`  [${s.status}] ${s.type} -> ${s.assignedAgentId} qaScore=${s.qaScore} attempts=${s.attemptCount}`);
    console.log(`    output preview: ${(s.output ?? "").slice(0, 150).replace(/\n/g, " ")}...`);
  }

  const events = await prisma.event.findMany({ where: { taskId: task.id, eventType: "WORK_COMPLETED" } });
  const geminiSourced = events.filter((e) => (JSON.parse(e.payload) as { source?: string }).source === "gemini");
  console.log(`\nWORK_COMPLETED events using real Gemini: ${geminiSourced.length}/${events.length}`);
  console.assert(geminiSourced.length === events.length, "expected ALL work events to be gemini-sourced, not fallback");

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
