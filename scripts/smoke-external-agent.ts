// End-to-end run of the external agent marketplace against the configured
// MongoDB: register provider -> register agent -> test connection ->
// calibrate -> becomes ACTIVE -> create a real task -> the external agent
// is discovered/filtered/ranked alongside built-ins -> gets selected ->
// executes over real HTTP -> QA -> escrow settles -> performance/reputation
// update -> a second task shows the "warmed" history affecting ranking.
//
//   npx tsx --env-file=.env scripts/smoke-external-agent.ts
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { runTask } from "@/lib/manager/orchestrator";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";
import { ensureAgentWallet } from "@/lib/economy/wallets";
import { calibrateExternalAgent } from "@/lib/agents/calibration";
import { discoverAgents } from "@/lib/discovery";

// A real, separate HTTP server standing in for an independent provider's
// agent (same contract the bundled app/api/demo-external-agent routes
// implement) - this is the "third party" Kraven calls over the network.
function startThirdPartyAgent(): Promise<{ url: string; close: () => Promise<void>; calls: number }> {
  const state = { calls: 0 };
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") return void res.end(JSON.stringify({ status: "ok" }));
    if (req.url === "/execute") {
      state.calls += 1;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      // Capability-aware, so a financial_analysis request doesn't get
      // market-research prose back (which deterministic QA correctly fails).
      const output =
        body.capability === "financial_analysis"
          ? `## Financial Metrics\n\nFor: ${body.prompt}\n\n- Estimated addressable market: $8-12B (estimate; basis: segment revenue extrapolation)\n- Typical gross margin for embedded-lending neobanks: 55-65% (estimate; basis: comparable public fintech filings)\n- Expected 3-year CAGR: 18-24% (estimate; basis: historical segment growth)\n\nAll figures are estimates pending access to primary sources; assumptions are stated next to each metric.`
          : `## Market Research\n\nSegment analysis for: ${body.prompt}\n\n1. Digital-first neobanks serving underbanked SMEs show the strongest growth, driven by low-cost onboarding and embedded lending.\n2. API-first payment infrastructure providers benefit from rising e-commerce volume and multi-rail routing demand.\n3. Regtech/compliance-as-a-service is growing as regulation (PSD3-style frameworks) raises the cost of in-house compliance.\n\nEach segment is sized qualitatively here; a follow-on financial_analysis step would attach quantitative estimates.`;
      return void res.end(JSON.stringify({ status: "completed", output, metadata: { tokens: output.length } }));
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        get calls() { return state.calls; },
      });
    });
  });
}

async function runOneTask(prompt: string, budget: number, qualityThreshold: number) {
  const task = await db.task.create({ data: { prompt, budget, remainingBudget: budget, qualityThreshold, status: "CREATED", userId: DEMO_USER_ID } });
  await emitEvent(db, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt, budget } });
  await runTask(task.id);
  return db.task.findUniqueOrThrow({ where: { id: task.id } });
}

async function main() {
  await seedRegistry();
  await ensureDemoUser();

  const { url, close } = await startThirdPartyAgent();

  console.log(`\n=== 1. Provider + agent registration ===`);
  const provider = await db.agentProvider.create({ data: { name: "DeepResearch AI", ownerUserId: "smoke-test-owner", status: "ACTIVE" } });
  const agent = await db.agent.create({
    data: {
      name: "DeepResearch",
      role: "Independent market research agent",
      capabilities: JSON.stringify(["market_research", "financial_analysis"]),
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
  console.log(`provider=${provider.id} agent=${agent.id} lifecycleStatus=${agent.lifecycleStatus} status=${agent.status}`);

  console.log(`\n=== 2. Calibration (real HTTP round trip to ${url}) ===`);
  const calibration = await calibrateExternalAgent(agent.id);
  console.log(`calibration passed=${calibration.passed} lifecycleStatus=${calibration.lifecycleStatus}`);
  console.log(calibration.runs.map((r) => `  ${r.capability}: ${r.status}${r.qaScore != null ? ` qa=${r.qaScore}` : ""}${r.reason ? ` (${r.reason})` : ""}`).join("\n"));

  const afterCalibration = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
  console.log(`agent is now status=${afterCalibration.status} lifecycleStatus=${afterCalibration.lifecycleStatus}`);
  if (afterCalibration.status !== "ACTIVE") {
    console.error("Calibration did not activate the agent - aborting (check Sarvam config / QA thresholds).");
    return;
  }

  console.log(`\n=== 3. Discovery includes the external agent alongside built-ins ===`);
  const candidates = await discoverAgents("market_research");
  console.log(`discovered ${candidates.length} candidates: ${candidates.map((c) => `${c.name}${c.isExternal ? " (external)" : ""}`).join(", ")}`);

  console.log(`\n=== 4. Real task #1 (cold start) ===`);
  const task1 = await runOneTask("Analyze the Indian EV startup market and identify the three most promising segments.", 40, 70);
  const subtasks1 = await db.subtask.findMany({ where: { taskId: task1.id } });
  const wonByExternal1 = subtasks1.some((s) => s.assignedAgentId === agent.id);
  console.log(`task1 status=${task1.status} selected external agent for a subtask: ${wonByExternal1}`);

  console.log(`\n=== 5. Real task #2 (warmed history should now inform ranking) ===`);
  const task2 = await runOneTask("Analyze the Indonesian EV startup market and identify the three most promising segments.", 40, 70);
  const subtasks2 = await db.subtask.findMany({ where: { taskId: task2.id } });
  const wonByExternal2 = subtasks2.some((s) => s.assignedAgentId === agent.id);
  console.log(`task2 status=${task2.status} selected external agent for a subtask: ${wonByExternal2}`);

  const perf = await db.agentPerformance.findMany({ where: { agentId: agent.id } });
  const capStats = await db.agentCapabilityStat.findMany({ where: { agentId: agent.id } });
  console.log(`\n=== Performance/reputation feedback loop ===`);
  console.log(`AgentPerformance rows for this agent: ${perf.length}`);
  console.log(`AgentCapabilityStat: ${capStats.map((s) => `${s.capability}: quality=${Math.round(s.avgQuality)} success=${Math.round(s.successRate * 100)}% n=${s.sampleCount}`).join("; ")}`);

  await close();
  console.log(`\ndone. providerId=${provider.id} agentId=${agent.id} task1=${task1.id} task2=${task2.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongoose());
