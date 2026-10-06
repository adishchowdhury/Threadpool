import { taskPlanSchema, type TaskPlan, type SubtaskPlan } from "@/lib/manager/schemas";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateStructured } from "@/lib/manager/structuredGenerate";
import { CAPABILITY_CATALOG, CAPABILITY_IDS, REPORT_CAPABILITIES, type CapabilityId, type CapabilityStage } from "@/lib/capabilities/catalog";
import { extractDatasets } from "@/lib/tools/dataEngine";

// Task planning. The Manager LLM proposes a workflow from the capability
// catalog; Kraven then normalizes it into a valid DAG (dependencies only on
// earlier steps, a synthesis step, exactly one final verification step) and
// fits it to the budget against real agent prices. Without a model, a
// deterministic signal-based planner builds the workflow instead, so routing
// still adapts to the task rather than following one fixed template.

const stageOf = (c: string): CapabilityStage => CAPABILITY_CATALOG[c as CapabilityId]?.stage ?? "analyze";
const isReport = (c: string) => (REPORT_CAPABILITIES as readonly string[]).includes(c);

// ── normalization ──────────────────────────────────────────────────────

export function normalizePlan(input: TaskPlan): { plan: TaskPlan; adjustments: string[] } {
  const adjustments: string[] = [];
  const sorted = [...input.subtasks].sort((a, b) => a.sequence - b.sequence);

  // Intermediate verification steps are dropped: the single final review
  // (re-added below) covers the whole deliverable.
  const content = sorted.filter((s) => s.requiredCapability !== "quality_verification");
  if (content.length !== sorted.length) adjustments.push("removed planner-supplied verification step(s); one final review is added");

  // Renumber 0..n-1 and keep only dependencies on EARLIER steps - the
  // workflow is a DAG by construction (no self-, forward or cyclic edges).
  const oldToNew = new Map<number, number>();
  const steps: SubtaskPlan[] = [];
  content.forEach((s, i) => {
    if (oldToNew.has(s.sequence)) adjustments.push(`duplicate sequence ${s.sequence} renumbered`);
    oldToNew.set(s.sequence, i);
    const deps = [...new Set(s.dependsOnSequence.map((d) => oldToNew.get(d)).filter((d): d is number => d !== undefined && d < i))];
    if (deps.length !== s.dependsOnSequence.length) adjustments.push(`step ${i} (${s.type}): dropped invalid/forward dependencies`);
    steps.push({ ...s, sequence: i, dependsOnSequence: deps });
  });

  if (steps.length === 0) {
    steps.push({ type: "report_writing", requiredCapability: "report_generation", description: "Produce the requested deliverable.", sequence: 0, dependsOnSequence: [] });
    adjustments.push("plan had no content steps; added a report step");
  }

  // Wire missing edges so material actually flows: analysis sees gathered
  // material; data analysis also sees earlier analyses; synthesis sees all.
  for (const s of steps) {
    const earlier = steps.filter((e) => e.sequence < s.sequence);
    const stage = stageOf(s.requiredCapability);
    let required: number[] = [];
    if (stage === "analyze") {
      required = earlier.filter((e) => stageOf(e.requiredCapability) === "gather" || (s.requiredCapability === "data_analysis" && stageOf(e.requiredCapability) === "analyze")).map((e) => e.sequence);
    } else if (stage === "synthesize" || stage === "verify") {
      required = earlier.filter((e) => stageOf(e.requiredCapability) !== "verify").map((e) => e.sequence);
    }
    const missing = required.filter((r) => !s.dependsOnSequence.includes(r));
    if (missing.length) {
      s.dependsOnSequence = [...s.dependsOnSequence, ...missing].sort((a, b) => a - b);
      adjustments.push(`step ${s.sequence} (${s.type}): added inputs from step(s) ${missing.join(", ")}`);
    }
  }

  if (!steps.some((s) => isReport(s.requiredCapability))) {
    const seq = steps.length;
    steps.push({
      type: "report_writing",
      requiredCapability: "report_generation",
      description: "Synthesize every upstream output into the final deliverable for the user, carrying source tags through.",
      sequence: seq,
      dependsOnSequence: steps.map((s) => s.sequence),
    });
    adjustments.push("added a report step to synthesize the deliverable");
  }

  steps.push({
    type: "quality_review",
    requiredCapability: "quality_verification",
    description: "Review the final deliverable against the user's task; attribute every problem to the step that must fix it.",
    sequence: steps.length,
    dependsOnSequence: steps.map((s) => s.sequence),
  });

  return { plan: { summary: input.summary, subtasks: steps }, adjustments };
}

// ── budget fitting ─────────────────────────────────────────────────────

// Drops the lowest-priority gather/analyze steps until the cheapest possible
// staffing of the plan fits the budget, and drops steps no hireable agent
// can do. Synthesis and verification are never dropped. A dropped step's
// dependents inherit its inputs, so the DAG stays connected.
export function fitPlanToBudget(
  plan: TaskPlan,
  priceFloor: ReadonlyMap<string, number>,
  budget: number,
): { plan: TaskPlan; dropped: Array<{ type: string; capability: string; reason: string }>; estimatedMinCost: number } {
  let steps = plan.subtasks.map((s) => ({ ...s, dependsOnSequence: [...s.dependsOnSequence] }));
  const dropped: Array<{ type: string; capability: string; reason: string }> = [];
  const droppable = (s: SubtaskPlan) => {
    const st = stageOf(s.requiredCapability);
    return (st === "gather" || st === "analyze") && steps.filter((o) => ["gather", "analyze"].includes(stageOf(o.requiredCapability))).length > 1;
  };
  const drop = (victim: SubtaskPlan, reason: string) => {
    dropped.push({ type: victim.type, capability: victim.requiredCapability, reason });
    steps = steps
      .filter((s) => s !== victim)
      .map((s) =>
        s.dependsOnSequence.includes(victim.sequence)
          ? { ...s, dependsOnSequence: [...new Set([...s.dependsOnSequence.filter((d) => d !== victim.sequence), ...victim.dependsOnSequence])] }
          : s,
      );
  };

  for (const s of [...steps]) {
    if (!priceFloor.has(s.requiredCapability) && droppable(s)) drop(s, "no hireable agent offers this capability");
  }
  const cost = () => steps.reduce((sum, s) => sum + (priceFloor.get(s.requiredCapability) ?? 0), 0);
  while (cost() > budget) {
    const candidates = steps.filter(droppable).sort((a, b) => CAPABILITY_CATALOG[a.requiredCapability].budgetPriority - CAPABILITY_CATALOG[b.requiredCapability].budgetPriority);
    if (candidates.length === 0) break;
    drop(candidates[0], `cheapest staffing of the full plan exceeds the budget of ${budget}`);
  }

  // Renumber to keep sequences contiguous.
  const map = new Map(steps.map((s, i) => [s.sequence, i]));
  steps = steps.map((s, i) => ({ ...s, sequence: i, dependsOnSequence: s.dependsOnSequence.map((d) => map.get(d)!).filter((d) => d !== undefined) }));
  return { plan: { ...plan, subtasks: steps }, dropped, estimatedMinCost: cost() };
}

// ── deterministic planner (no model) ──────────────────────────────────

const SIGNALS = {
  competitive: /\b(compar\w*|competitor\w*|competition|competitive|vs\.?|versus|top \d+|leading (companies|players|brands|firms)|landscape|rivals?|market share|benchmark(ing)? against)\b/i,
  data: /\b(data ?set|data|csv|json|spreadsheet|table|statistic\w*|calculat\w*|quantitative|cagr|averages?|correlat\w*|regression|distribution)\b/i,
  financial: /\b(financ\w*|valuation|revenue|margins?|unit economics|invest\w*|profit\w*|ebitda|burn|cash ?flow|metrics)\b/i,
  market: /\b(markets?|segments?|industry|sector|opportunit\w*|tam|sizing|demand|trends?)\b/i,
  fresh: /\b(latest|current|recent|today|this year|20[2-3]\d|news|now|startups?|compan(y|ies)|players|pricing|prices|funding|regulat\w*|markets?|industry)\b/i,
  summaryOnly: /^\s*(summari[sz]e|tl;?dr|condense)\b/i,
  risk: /\b(risks?|downside|what could go wrong|headwinds?|red flags?)\b/i,
  regulatory: /\b(regulat\w*|complian\w*|licens(e|ing|ure)|legal requirements?|jurisdiction\w*|kyc|aml)\b/i,
};

export function heuristicPlan(prompt: string): TaskPlan {
  const hasData = extractDatasets(prompt, "task").length > 0;
  const competitive = SIGNALS.competitive.test(prompt);
  const dataNeeded = hasData || SIGNALS.data.test(prompt) || (competitive && /\btop \d+|market share|compare\b/i.test(prompt));
  const financial = SIGNALS.financial.test(prompt);
  const market = SIGNALS.market.test(prompt) && !competitive;
  const fresh = SIGNALS.fresh.test(prompt) && !(hasData && !SIGNALS.market.test(prompt) && !competitive);
  const risk = SIGNALS.risk.test(prompt);
  const regulatory = SIGNALS.regulatory.test(prompt);

  const steps: Array<{ cap: CapabilityId; type: string; description: string }> = [];
  if (fresh) steps.push({ cap: "web_research", type: "web_research", description: `Find current, citable facts for: ${prompt}` });
  if (market) steps.push({ cap: "market_research", type: "market_research", description: `Map the market structure, segments and growth drivers for: ${prompt}` });
  if (competitive) steps.push({ cap: "competitive_analysis", type: "competitive_analysis", description: `Identify and compare the relevant competitors (positioning, pricing, features, comparable metrics, SWOT) for: ${prompt}` });
  if (financial) steps.push({ cap: "financial_analysis", type: "financial_analysis", description: `Estimate the key financial metrics, stating assumptions, for: ${prompt}` });
  if (dataNeeded) steps.push({ cap: "data_analysis", type: "data_analysis", description: `Compute rankings, shares, growth and summary statistics from the available data for: ${prompt}` });
  if (regulatory) steps.push({ cap: "regulatory_compliance", type: "regulatory_compliance", description: `Identify the regulatory, licensing and compliance obligations relevant to: ${prompt}` });
  if (risk) steps.push({ cap: "risk_assessment", type: "risk_assessment", description: `Identify and rate the key risks (market, execution, financial, regulatory), with mitigations, for: ${prompt}` });
  if (steps.length === 0) steps.push({ cap: "market_research", type: "research", description: `Research the subject of: ${prompt}` });
  const synth: CapabilityId = SIGNALS.summaryOnly.test(prompt) ? "summarization" : "report_generation";
  steps.push({ cap: synth, type: synth === "summarization" ? "summary" : "report_writing", description: `Synthesize the upstream work into the final deliverable for: ${prompt}` });

  return {
    summary: prompt.length > 140 ? `${prompt.slice(0, 137)}...` : prompt,
    // Dependencies are filled in by normalizePlan's wiring rules.
    subtasks: steps.map((s, i) => ({ type: s.type, requiredCapability: s.cap, description: s.description, sequence: i, dependsOnSequence: [] })),
  };
}

// ── Manager LLM planner ────────────────────────────────────────────────

function capabilityMenu(): string {
  return CAPABILITY_IDS.filter((c) => c !== "quality_verification")
    .map((c) => `- ${c}: ${CAPABILITY_CATALOG[c].plannerGuidance}`)
    .join("\n");
}

export async function decomposeTask(params: {
  prompt: string;
  budget: number;
  qualityThreshold?: number;
}): Promise<{ plan: TaskPlan; source: "sarvam" | "local_fallback"; adjustments: string[] }> {
  if (!isSarvamConfigured()) {
    const n = normalizePlan(heuristicPlan(params.prompt));
    return { plan: n.plan, source: "local_fallback", adjustments: n.adjustments };
  }

  try {
    const object = await generateStructured({
      schema: taskPlanSchema,
      prompt: `You are the Manager of Kraven, which builds and manages an AI workforce to complete a user's goal.
Design the workflow: 2-6 concrete steps, each needing exactly one capability from this catalog:
${capabilityMenu()}

Rules:
- Choose capabilities from what the task actually needs; do not include a capability just because it exists. Fewer steps that cover the task are better - every step costs budget.
- If the task depends on current or named real-world facts, start with web_research so later steps work from cited sources.
- Express dependencies with dependsOnSequence (only earlier steps). Analysis steps should depend on the research they use; the final writing/report step on everything it synthesizes.
- Each description must be a concrete instruction for that worker (what to produce, for which entities, at what depth).
- Do not add a quality_verification step; Kraven adds an independent final review automatically.

User task: "${params.prompt}"
Hard token budget: ${params.budget}${params.qualityThreshold ? `\nRequired quality: ${params.qualityThreshold}/100` : ""}`,
    });
    const n = normalizePlan(object);
    return { plan: n.plan, source: "sarvam", adjustments: n.adjustments };
  } catch (err) {
    console.error("[Manager] Sarvam task decomposition failed, using deterministic planner:", err);
    const n = normalizePlan(heuristicPlan(params.prompt));
    return { plan: n.plan, source: "local_fallback", adjustments: n.adjustments };
  }
}

// Workflow-memory key: the set of content capabilities, so tasks with the
// same workflow shape are compared with each other.
export function workflowSignature(plan: TaskPlan): string {
  return [...new Set(plan.subtasks.map((s) => s.requiredCapability).filter((c) => stageOf(c) !== "verify"))].sort().join("+");
}
