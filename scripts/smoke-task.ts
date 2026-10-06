// End-to-end run of the real task pipeline against the configured MongoDB:
// plan -> discover -> filter -> rank -> escrow -> execute -> QA -> pay ->
// final review -> rework -> report. Creates the task exactly like
// POST /api/tasks, then prints the event timeline, ledger and report.
//   npx tsx --env-file=.env scripts/smoke-task.ts ["prompt"] [budget] [qualityThreshold]
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { runTask } from "@/lib/manager/orchestrator";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";

const prompt = process.argv[2] ?? "Analyze the Indian EV market and compare the top 5 companies.";
const budget = Number(process.argv[3] ?? 50);
const qualityThreshold = Number(process.argv[4] ?? 80);

function line(e: { eventType: string; actor: string; payload: string }) {
  const p = JSON.parse(e.payload) as Record<string, unknown>;
  const pick = (keys: string[]) => keys.filter((k) => p[k] !== undefined && p[k] !== null).map((k) => `${k}=${typeof p[k] === "object" ? JSON.stringify(p[k]) : p[k]}`).join(" ");
  switch (e.eventType) {
    case "SUBTASK_CREATED": return pick(["sequence", "requiredCapability", "dependsOnSequence", "planSource"]);
    case "PLAN_ADJUSTED": return pick(["normalization", "dropped", "estimatedMinCost"]);
    case "AGENTS_FILTERED": return pick(["stages", "reserve", "spendCap"]);
    case "AGENT_SELECTED": return String(p.explanation ?? "");
    case "TOOL_CALLED": return pick(["capability", "tool", "ok", "summary", "error"]);
    case "WORK_STARTED": return pick(["attempt", "revision", "feedback"]).slice(0, 300);
    case "WORK_COMPLETED": return pick(["source", "revision"]);
    case "QA_PASSED": case "QA_FAILED": return pick(["score", "revision", "reason", "issues"]).slice(0, 400);
    case "INTEGRATION_REVIEW_COMPLETED": return `${pick(["round", "approved", "score"])} issues=${JSON.stringify((p.issues as Array<Record<string, unknown>>)?.map((i) => `${i.severity}@${i.targetSequence}:${String(i.description).slice(0, 90)}`))}`;
    case "REWORK_REQUESTED": return pick(["round", "targets", "rerun"]).slice(0, 500);
    case "TRANSACTION_APPROVED": case "TRANSACTION_BLOCKED": case "ESCROW_LOCKED": case "ESCROW_REFUNDED": return pick(["agentId", "amount", "reason"]);
    case "WEB_DATA_FETCHED": return pick(["capability", "available", "reason"]) + ` sources=${(p.sources as unknown[])?.length ?? 0}`;
    case "TASK_FAILED": return pick(["reason"]);
    default: return "";
  }
}

async function main() {
  await seedRegistry();
  await ensureDemoUser();
  const task = await db.task.create({
    data: { prompt, budget, remainingBudget: budget, qualityThreshold, status: "CREATED", userId: DEMO_USER_ID },
  });
  await emitEvent(db, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt, budget } });
  const t0 = Date.now();
  await runTask(task.id);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

  const events = await db.event.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
  const skip = new Set(["BID_RECEIVED", "REPUTATION_UPDATED", "QA_STARTED", "AGENTS_DISCOVERED", "AGENTS_RANKED", "WORKFORCE_CONSTRUCTED"]);
  console.log(`\n=== TIMELINE (${events.length} events, ${elapsed}s) ===`);
  for (const e of events) if (!skip.has(e.eventType)) console.log(`${e.eventType.padEnd(28)} ${e.actor.padEnd(18)} ${line(e)}`);

  const final = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  const subtasks = await db.subtask.findMany({ where: { taskId: task.id }, orderBy: { sequence: "asc" } });
  console.log(`\n=== RESULT: ${final.status}, budget ${final.budget}, remaining ${final.remainingBudget} ===`);
  for (const s of subtasks) console.log(`  ${s.sequence}. ${s.requiredCapability.padEnd(22)} ${s.status.padEnd(6)} agent=${s.assignedAgentId} qa=${s.qaScore} attempts=${s.attemptCount}`);
  const escrows = await db.agentEscrow.findMany({ where: { taskId: task.id } });
  console.log(`escrows: ${escrows.map((e: { agentId: string; amount: number; status: string }) => `${e.agentId}:${e.amount}:${e.status}`).join(", ")}`);
  const out = final.finalOutput ? JSON.parse(final.finalOutput) : null;
  if (out?.content) {
    console.log(`review: ${JSON.stringify(out.review)}`);
    console.log(`spend: ${JSON.stringify(out.spend_summary)}`);
    console.log(`sources: ${out.sources.length} (${out.sources.filter((s: { cited: boolean }) => s.cited).length} cited)`);
    console.log(`numeric checks: ${out.numeric_checks.status} ${out.numeric_checks.consistent}/${out.numeric_checks.checked}`);
    console.log(`\n=== REPORT ===\n${out.content}`);
  } else console.log(JSON.stringify(out));
  console.log(`\ntaskId=${task.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
