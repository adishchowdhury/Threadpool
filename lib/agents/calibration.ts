import { db } from "@/lib/db/client";
import { evaluatePublish } from "@/lib/discovery/access";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { refreshAgentStats } from "@/lib/agents/stats";
import { ROSTER } from "@/lib/agents/roster";
import { SARVAM_MODEL_TIERS, type SarvamModelTier } from "@/lib/manager/sarvam";
import { emitEvent } from "@/lib/events/emit";
import type { UpstreamItem } from "@/lib/capabilities/types";

// Calibration: run each agent on a fixed, capability-specific benchmark with
// the real worker and the real, independent QA reviewer, and store what was
// measured. This is how an agent gets its first quality/success/latency
// numbers - measured, not asserted. Real task executions then keep refining
// them (lib/agents/stats.ts).
const QA_THRESHOLD = 80;
const CONCURRENCY = 3;

const SAMPLE_REPORT = `Executive summary: The European neobank sector grew revenue about 30% last year.
Segments: (1) consumer neobanks, (2) SME banking, (3) embedded finance.
Financials: SME banking looks most attractive with higher margins.
Recommendation: invest in SME banking.`;

const BENCHMARK_DATA = `company,revenue_2022_usd_m,revenue_2024_usd_m,employees
Northwind,120,210,850
Contoso,340,395,2100
Fabrikam,95,180,640
Tailspin,60,58,410
Litware,210,300,1500`;

const BENCHMARKS: Record<string, { taskPrompt: string; description: string; upstream?: UpstreamItem[] }> = {
  web_research: {
    taskPrompt: "What are the latest developments in India's electric two-wheeler market?",
    description: "Web research: find current, citable facts (sales volumes, leading companies, policy changes) and keep sourced facts separate from analysis.",
  },
  competitive_analysis: {
    taskPrompt: "Compare the leading project-management SaaS tools (Asana, Monday.com, ClickUp, Notion) for a 50-person startup.",
    description: "Competitive analysis: positioning, pricing, key features, strengths and weaknesses of each tool, plus a SWOT for the category.",
  },
  data_analysis: {
    taskPrompt: `Analyze this company dataset:\n\n\`\`\`csv\n${BENCHMARK_DATA}\n\`\`\``,
    description: "Data analysis: rank companies by 2024 revenue, compute 2022-2024 growth and CAGR, revenue per employee, and market concentration.",
  },
  market_research: {
    taskPrompt: "Analyze the European fintech startup market and identify three promising segments.",
    description: "Market research: segment the market and identify the three most promising segments with brief justification.",
  },
  financial_analysis: {
    taskPrompt: "Estimate key financial metrics for the three most promising European fintech segments.",
    description: "Financial analysis: estimate market size, growth rate and typical margins for each segment, stating assumptions.",
  },
  data_extraction: {
    taskPrompt: "Collect the key facts about the European fintech funding landscape.",
    description: "Data extraction: list the main facts (funding volumes, leading investors, notable rounds) as structured bullet points.",
  },
  writing: {
    taskPrompt: "Write a short briefing for an investment committee on the European fintech market.",
    description: "Writing: draft a concise, well-organized briefing with a clear structure.",
  },
  report_generation: {
    taskPrompt: "Produce an investment-style report on the European fintech market.",
    description: "Report generation: executive summary, segments, key metrics, risks and a recommendation.",
  },
  summarization: {
    taskPrompt:
      "Summarize: European fintech funding fell from its 2021 peak, but payments and SME lending segments kept growing as incumbents partnered with startups, while regulation (PSD3, MiCA) raised compliance costs for smaller players.",
    description: "Summarization: condense the passage into 2-3 sentences without losing any key fact.",
  },
  quality_verification: {
    // The review runtime reviews upstream workflow output, so the draft is
    // supplied as the output of a report step.
    taskPrompt: "Analyze the European fintech market, identify three segments and estimate their financial metrics.",
    description: "Quality verification: state whether the draft meets the requirement and attribute every gap to the step that must fix it.",
    upstream: [{ sequence: 0, type: "report_writing", capability: "report_generation", output: SAMPLE_REPORT }],
  },
  review: {
    taskPrompt: `Review this draft report:\n\n${SAMPLE_REPORT}`,
    description: "Review: give the main strengths and the most important problems, with concrete fixes.",
  },
};

export interface CalibrationRun {
  agentId: string;
  capability: string;
  status: "recorded" | "skipped";
  qaScore?: number;
  passed?: boolean;
  latencyMs?: number;
  reason?: string;
}

async function calibrateOne(agent: { id: string; model: string | null }, capability: string): Promise<CalibrationRun> {
  const bench = BENCHMARKS[capability];
  if (!bench) return { agentId: agent.id, capability, status: "skipped", reason: "no benchmark defined for capability" };

  const exec = await executeSubtask({
    type: capability,
    description: bench.description,
    taskPrompt: bench.taskPrompt,
    agentId: agent.id,
    webGrounding: false,
    upstream: bench.upstream,
  });
  // A fallback placeholder (or a failed external call) is not the agent's
  // real work - never score it. "external" = a genuine round trip to the
  // provider's endpoint succeeded; that IS real work, score it.
  if (!exec.source.startsWith("sarvam") && exec.source !== "external") {
    return { agentId: agent.id, capability, status: "skipped", reason: `worker did not produce real output (${exec.source}): ${exec.source === "external_error" ? exec.output : ""}`.trim() };
  }

  const qa = await verifySubtaskOutput({
    type: capability,
    description: bench.description,
    output: exec.output,
    qualityThreshold: QA_THRESHOLD,
    artifacts: exec.artifacts,
    knownSources: exec.artifacts?.sources ?? [],
  });
  // "rubric" = the deterministic length check rejected the output; that is a real verdict on the agent.
  if (qa.source === "local_fallback") {
    return { agentId: agent.id, capability, status: "skipped", reason: `QA did not run on Sarvam (${qa.source})` };
  }

  const tier = (agent.model as SarvamModelTier | null) ?? "economy";
  await db.agentCalibration.create({
    data: {
      agentId: agent.id,
      capability,
      model: SARVAM_MODEL_TIERS[tier].model,
      latencyMs: exec.actualLatencyMs,
      inputTokens: exec.usage?.inputTokens ?? 0,
      outputTokens: exec.usage?.outputTokens ?? 0,
      qaScore: qa.verdict.score,
      passed: qa.verdict.passed,
    },
  });
  return { agentId: agent.id, capability, status: "recorded", qaScore: qa.verdict.score, passed: qa.verdict.passed, latencyMs: exec.actualLatencyMs };
}

// Calibrates every active worker agent (or just `agentIds`) on each of its
// capabilities. Replaces that agent's previous calibration samples so
// re-running reflects current behavior instead of accumulating stale data.
//
// Also includes INACTIVE agents (but not REVOKED ones - that's the
// permanent, severe-violation gate, untouched by this): reputation.ts's
// auto-demotion (3 consecutive failures) calls itself "reversible", but
// nothing ever reversed it - discovery and this function's own query both
// excluded INACTIVE agents, so once demoted an agent could never be
// re-tested or re-enter the pool even after whatever caused the failures
// (e.g. a too-tight call timeout) was fixed. See the reactivation block
// below.
export async function calibrateAgents(options: { agentIds?: string[] } = {}): Promise<CalibrationRun[]> {
  const agents = await db.agent.findMany({ where: { status: { in: ["ACTIVE", "INACTIVE"] } } });
  const rostered = new Set(ROSTER.map((a) => a.id));
  const targets = agents.filter((a) => rostered.has(a.id) && (options.agentIds ? options.agentIds.includes(a.id) : true));

  const jobs: Array<{ agent: (typeof agents)[number]; capability: string }> = [];
  for (const agent of targets) {
    for (const capability of JSON.parse(agent.capabilities) as string[]) {
      if (BENCHMARKS[capability]) jobs.push({ agent, capability });
    }
  }

  // Delete old samples only for agents we are about to re-measure, and only
  // once the new run has produced data (below), so a failed run keeps history.
  const results: CalibrationRun[] = [];
  const runStart = new Date();

  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        results.push(await calibrateOne(job.agent, job.capability));
      } catch (err) {
        results.push({
          agentId: job.agent.id,
          capability: job.capability,
          status: "skipped",
          reason: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  // Drop each agent's pre-run samples for capabilities that got fresh ones.
  for (const r of results) {
    if (r.status !== "recorded") continue;
    await db.agentCalibration.deleteMany({
      where: { agentId: r.agentId, capability: r.capability, createdAt: { lt: runStart } },
    });
  }
  for (const id of new Set(results.map((r) => r.agentId))) await refreshAgentStats(id);

  // Reactivation: an INACTIVE agent that just demonstrated it can pass QA
  // again earns its way back into the discoverable pool. Requires an actual
  // passing, real (non-fallback) run in THIS batch - not merely "didn't get
  // worse" - so a lucky skip doesn't quietly un-demote a still-broken agent.
  const inactiveById = new Map(targets.filter((a) => a.status === "INACTIVE").map((a) => [a.id, a]));
  const passedAgentIds = new Set(results.filter((r) => r.status === "recorded" && r.passed).map((r) => r.agentId));
  for (const [agentId, agent] of inactiveById) {
    if (!passedAgentIds.has(agentId)) continue;
    await db.agent.update({ where: { id: agentId }, data: { status: "ACTIVE", consecutiveFailures: 0, demotedAt: null } });
    await emitEvent(db, {
      actor: "system",
      eventType: "AGENT_REACTIVATED",
      payload: { agentId, name: agent.name, reason: "passed re-calibration after auto-demotion" },
    });
  }

  return results;
}

export interface ExternalCalibrationSummary {
  runs: CalibrationRun[];
  passed: boolean;
  lifecycleStatus: "ACTIVE" | "FAILED_CALIBRATION";
}

// Calibrates an EXTERNAL agent against the same fixed, capability-specific
// benchmarks as built-in agents, through the real outbound HTTP path
// (worker.ts dispatches to executeExternalAgentSubtask for any agent with
// isExternal=true, so calibrateOne above needs no external-specific code).
// Gates the agent into routing: it only becomes ACTIVE once at least one
// declared capability actually passes QA against real output from its
// endpoint - a provider's own claims about quality are never trusted.
export async function calibrateExternalAgent(agentId: string): Promise<ExternalCalibrationSummary> {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  if (!agent.isExternal) throw new Error(`agent ${agentId} is not an external agent`);

  const declaredCapabilities = JSON.parse(agent.capabilities) as string[];
  const runStart = new Date();
  const runs: CalibrationRun[] = [];
  for (const capability of declaredCapabilities) {
    try {
      runs.push(await calibrateOne({ id: agent.id, model: agent.model }, capability));
    } catch (err) {
      runs.push({ agentId, capability, status: "skipped", reason: err instanceof Error ? err.message : "unknown error" });
    }
  }

  for (const r of runs) {
    if (r.status !== "recorded") continue;
    await db.agentCalibration.deleteMany({ where: { agentId, capability: r.capability, createdAt: { lt: runStart } } });
  }

  const passed = runs.some((r) => r.status === "recorded" && r.passed);
  const lifecycleStatus = passed ? "ACTIVE" : "FAILED_CALIBRATION";

  await db.agent.update({
    where: { id: agentId },
    data: { lifecycleStatus, status: passed ? "ACTIVE" : "INACTIVE" },
  });
  await refreshAgentStats(agentId);

  // Owner asked for the marketplace: now that Kraven has measured the agent,
  // honour it (same gate as manual publishing).
  const after = await db.agent.findUnique({ where: { id: agentId } });
  if (after && after.visibilityPreference === "MARKETPLACE" && evaluatePublish(after).ok) {
    await db.agent.update({ where: { id: agentId }, data: { visibility: "MARKETPLACE" } });
  }

  return { runs, passed, lifecycleStatus };
}
