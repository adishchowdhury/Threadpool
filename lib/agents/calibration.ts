import { db } from "@/lib/db/client";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import { refreshAgentStats } from "@/lib/agents/stats";
import { ROSTER } from "@/lib/agents/roster";
import { SARVAM_MODEL_TIERS, type SarvamModelTier } from "@/lib/manager/sarvam";
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
  // A fallback placeholder is not the agent's work - never score it.
  if (!exec.source.startsWith("sarvam")) {
    return { agentId: agent.id, capability, status: "skipped", reason: `worker did not run on Sarvam (${exec.source})` };
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
export async function calibrateAgents(options: { agentIds?: string[] } = {}): Promise<CalibrationRun[]> {
  const agents = await db.agent.findMany({ where: { status: "ACTIVE" } });
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

  return results;
}
