// Concurrency check for the escrow settlement invariant ("escrow cannot be
// released twice", CLAUDE.md §18) against the configured MongoDB - including
// a standalone server with no transaction isolation. Fires concurrent
// refunds, then concurrent releases + refunds, and asserts the money moved
// exactly once.
//   npx tsx --env-file=.env scripts/smoke-escrow-race.ts
import assert from "node:assert/strict";
import { db } from "@/lib/db/client";
import { lockAgentEscrow, refundAgentEscrow, releaseAgentEscrow } from "@/lib/economy/escrow";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";

async function scenario(name: string, settle: (escrowId: string) => Promise<unknown>[]) {
  const task = await db.task.create({
    data: { prompt: `escrow race: ${name}`, budget: 20, remainingBudget: 20, qualityThreshold: 80, status: "IN_PROGRESS", userId: DEMO_USER_ID },
  });
  const sub = await db.subtask.create({ data: { taskId: task.id, type: "race", requiredCapability: "writing", sequence: 0 } });
  const lock = await lockAgentEscrow({ taskId: task.id, subtaskId: sub.id, agentId: "writer-01", amount: 4, purpose: "writing" });
  assert.equal(lock.blocked, false, "lock should be approved");
  const escrowId = (lock as { agentEscrow: { id: string } }).agentEscrow.id;

  await Promise.all(settle(escrowId));

  const ledger = await db.centralLedger.findMany({ where: { taskId: task.id, status: "APPROVED" } });
  const settled = ledger.filter((l: { type: string }) => l.type === "REFUND" || l.type === "PAYOUT");
  const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  const escrow = await db.agentEscrow.findUniqueOrThrow({ where: { id: escrowId } });
  console.log(`${name}: settlements=${settled.map((l: { type: string }) => l.type).join(",")} escrow=${escrow.status} remaining=${after.remainingBudget}`);
  assert.equal(settled.length, 1, "exactly one settlement");
  const expected = settled[0].type === "REFUND" ? 20 : 16;
  assert.equal(after.remainingBudget, expected, "budget moved exactly once");
  await db.task.update({ where: { id: task.id }, data: { status: "CANCELLED" } });
}

async function main() {
  await seedRegistry();
  await ensureDemoUser();
  await scenario("5 concurrent refunds", (id) => Array.from({ length: 5 }, () => refundAgentEscrow({ agentEscrowId: id, reason: "race_test" })));
  await scenario("3 releases vs 3 refunds", (id) => [
    ...Array.from({ length: 3 }, () => releaseAgentEscrow({ agentEscrowId: id, requestedAmount: 4, purpose: "writing" })),
    ...Array.from({ length: 3 }, () => refundAgentEscrow({ agentEscrowId: id, reason: "race_test" })),
  ]);
  console.log("PASS: escrow settles exactly once under concurrency");
}

main()
  .catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
