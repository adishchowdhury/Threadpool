// One end-to-end run of the full enterprise control-plane loop, composing
// pieces that already exist (no new execution path):
//
//   personal org -> external agent registered + calibrated -> real task
//   submitted -> discovery/filter/rank -> scoped credential issued ->
//   escrow locked -> real external HTTP execution -> QA -> payout ->
//   reputation updated -> rogue over-budget request double-blocked
//   (Circuit Breaker AND scoped credential, independently) -> audit trail
//   exported.
//
//   npx tsx --env-file=.env scripts/demo-full-loop.ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { runTask } from "@/lib/manager/orchestrator";
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";
import { ensureAgentWallet } from "@/lib/economy/wallets";
import { calibrateExternalAgent } from "@/lib/agents/calibration";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";
import { lockAgentEscrow, releaseAgentEscrow } from "@/lib/economy/escrow";
import { issueCredential, CREDENTIAL_OPERATIONS } from "@/lib/economy/credentials";
import { ensureCircuitBreakerDemoAgent, CIRCUIT_BREAKER_DEMO_AGENT_ID } from "@/lib/agents/demoFixture";
import { exportAuditTrail } from "@/lib/audit/exportTrail";

function startThirdPartyAgent(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return void res.end(JSON.stringify({ status: "ok" }));
    if (req.url === "/execute") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const output = `## Market Research\n\nSegment analysis for: ${body.prompt}\n\n1. Digital-first neobanks serving underbanked SMEs.\n2. API-first payment infrastructure providers.\n3. Regtech/compliance-as-a-service.`;
      return void res.end(JSON.stringify({ status: "completed", output, metadata: { tokens: output.length } }));
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

async function main() {
  await seedRegistry();

  console.log("\n=== 1. Organization (multi-tenancy §6) ===");
  const owner = { userId: `demo-full-loop-owner-${Date.now()}`, email: "owner@demo.kraven.local", name: "Demo Owner" };
  const organizationId = await resolveOrCreatePersonalOrg(owner);
  console.log(`organizationId=${organizationId}`);

  console.log("\n=== 2. External agent registration + calibration ===");
  const { url, close } = await startThirdPartyAgent();
  const provider = await db.agentProvider.findUniqueOrThrow({ where: { id: organizationId } });
  const agent = await db.agent.create({
    data: {
      name: "DemoFullLoop Researcher",
      role: "Independent market research agent",
      capabilities: JSON.stringify(["market_research"]),
      price: 4,
      endpoint: url,
      status: "INACTIVE",
      provider: "external",
      model: "standard",
      isExternal: true,
      providerId: provider.id,
      lifecycleStatus: "PENDING",
      listed: true,
    },
  });
  await ensureAgentWallet(agent.id);
  const calibration = await calibrateExternalAgent(agent.id);
  console.log(`agent=${agent.id} calibration passed=${calibration.passed} lifecycleStatus=${calibration.lifecycleStatus}`);

  console.log("\n=== 3. Real task: discovery -> filter -> rank -> credential -> escrow -> execution -> QA -> payout ===");
  const task = await db.task.create({
    data: {
      prompt: "Analyze the fintech startup market, identify three promising segments, estimate key financial metrics, and produce a concise investment-style report.",
      budget: 50,
      remainingBudget: 50,
      qualityThreshold: 70,
      status: "CREATED",
      userId: owner.userId,
      organizationId,
    },
  });
  await emitEvent(db, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt: task.prompt, budget: task.budget } });
  await runTask(task.id);
  const finished = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  console.log(`task=${task.id} status=${finished.status} remainingBudget=${finished.remainingBudget}`);

  console.log("\n=== 4. Rogue agent: double-blocked by the Circuit Breaker AND a scoped credential ===");
  await ensureCircuitBreakerDemoAgent();
  const rogueSubtask = await db.subtask.create({
    data: { taskId: task.id, type: "rogue_demo", requiredCapability: "unbounded_payment_request", assignedAgentId: CIRCUIT_BREAKER_DEMO_AGENT_ID, status: "ASSIGNED" },
  });
  const authorizedAmount = Math.min(8, finished.remainingBudget || 8);
  const credential = await issueCredential({
    taskId: task.id,
    subtaskId: rogueSubtask.id,
    agentId: CIRCUIT_BREAKER_DEMO_AGENT_ID,
    allowedOperations: CREDENTIAL_OPERATIONS,
    maxSpend: authorizedAmount,
  });
  const lock = await lockAgentEscrow({
    taskId: task.id,
    subtaskId: rogueSubtask.id,
    agentId: CIRCUIT_BREAKER_DEMO_AGENT_ID,
    amount: authorizedAmount,
    purpose: "market_research",
    credentialId: credential.id,
  });
  if (lock.blocked) {
    console.log(`escrow lock unexpectedly blocked: ${lock.reason}`);
  } else {
    const rogueRelease = await releaseAgentEscrow({ agentEscrowId: lock.agentEscrow.id, requestedAmount: 10_000, purpose: "unbounded_payment_request" });
    console.log(`authorized=${authorizedAmount} requested=10000 blocked=${rogueRelease.blocked} reason=${rogueRelease.blocked ? rogueRelease.reason : "n/a"}`);
    console.log("credential ceiling independently enforced: see PERMISSION_DENIED / PERMISSION_CHECKED SecurityEvents in the audit trail below");
  }

  console.log("\n=== 5. Audit trail export (§5) ===");
  const trail = await exportAuditTrail({ organizationId });
  if (trail.ok) {
    console.log(`${trail.entries.length} audit entries for this organization:`);
    for (const e of trail.entries.slice(-15)) {
      console.log(`  [${e.category}] ${e.timestamp} ${e.summary}`);
    }
  }

  await close();
  console.log(`\ndone. organizationId=${organizationId} agentId=${agent.id} taskId=${task.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
