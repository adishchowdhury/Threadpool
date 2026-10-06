// Single source of truth for what Kraven's workforce can do. Pure module (no
// server imports) so the planner, router, Circuit Breaker, worker runtime,
// QA rubric and dashboard all read the same list - previously each kept its
// own copy and they had drifted apart.
//
// A capability is a unit of work the Manager can plan and hire for. Agents
// (lib/agents/roster.ts) advertise capabilities; tools (lib/tools) are what a
// capability's runtime uses to do the work with something stronger than LLM
// recall alone.

export const CAPABILITY_IDS = [
  "web_research",
  "market_research",
  "competitive_analysis",
  "financial_analysis",
  "data_analysis",
  "data_extraction",
  "summarization",
  "writing",
  "report_generation",
  "quality_verification",
  "review",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

// What role a capability plays in a workflow DAG. Drives default dependency
// wiring, which outputs count as "the report", and which steps the
// integration review may send work back to.
export type CapabilityStage = "gather" | "analyze" | "synthesize" | "verify";

export interface CapabilitySpec {
  id: CapabilityId;
  label: string;
  stage: CapabilityStage;
  // Shown to the Manager LLM so it can decide when the capability is needed.
  plannerGuidance: string;
  // Tools the capability's runtime may call (names from lib/tools/registry).
  tools: string[];
  // Generic (non-specialised) runtime: do a live web pass first when no
  // upstream web research is available.
  webGrounded: boolean;
  // Lower = dropped first when a plan does not fit the budget. Synthesis and
  // verification are never dropped (see fitPlanToBudget).
  budgetPriority: number;
}

export const CAPABILITY_CATALOG: Record<CapabilityId, CapabilitySpec> = {
  web_research: {
    id: "web_research",
    label: "Web research",
    stage: "gather",
    plannerGuidance:
      "Live web search with cited sources. Use whenever the task depends on current facts (named companies, recent funding, prices, market sizes, news, regulations) or anything after the model's training cutoff.",
    tools: ["web_search"],
    webGrounded: false,
    budgetPriority: 9,
  },
  market_research: {
    id: "market_research",
    label: "Market research",
    stage: "analyze",
    plannerGuidance: "Market structure, segments, trends, demand drivers and sizing logic.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 7,
  },
  competitive_analysis: {
    id: "competitive_analysis",
    label: "Competitive analysis",
    stage: "analyze",
    plannerGuidance:
      "Compare named companies/products on pricing, features, positioning; SWOT. Use when the task names or asks for competitors, 'top N companies', 'compare', 'vs', or a competitive landscape. Produces structured comparables other steps can use.",
    tools: ["upstream_lookup", "web_search"],
    webGrounded: false,
    budgetPriority: 8,
  },
  financial_analysis: {
    id: "financial_analysis",
    label: "Financial analysis",
    stage: "analyze",
    plannerGuidance: "Financial metrics, unit economics, valuation views and investment cases.",
    tools: ["web_search", "upstream_lookup", "calculate"],
    webGrounded: true,
    budgetPriority: 6,
  },
  data_analysis: {
    id: "data_analysis",
    label: "Data analysis",
    stage: "analyze",
    plannerGuidance:
      "Programmatic calculations and statistics over tables/CSV/JSON or figures gathered upstream (rankings, shares, growth, CAGR, averages, correlations). Use when the task supplies data or needs quantitative comparison; never needed for purely qualitative tasks.",
    tools: ["upstream_lookup", "analyze_data", "calculate"],
    webGrounded: false,
    budgetPriority: 5,
  },
  data_extraction: {
    id: "data_extraction",
    label: "Data extraction",
    stage: "gather",
    plannerGuidance: "Pull facts from provided material into clean structured lists/tables.",
    tools: ["web_search"],
    webGrounded: true,
    budgetPriority: 4,
  },
  summarization: {
    id: "summarization",
    label: "Summarization",
    stage: "synthesize",
    plannerGuidance: "Condense material without losing figures. Use when the user asks for a summary/brief rather than a full report.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 3,
  },
  writing: {
    id: "writing",
    label: "Writing",
    stage: "synthesize",
    plannerGuidance: "General business prose (memos, emails, briefs).",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 10,
  },
  report_generation: {
    id: "report_generation",
    label: "Report generation",
    stage: "synthesize",
    plannerGuidance: "Final structured report combining every upstream output, with source tags carried through.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 10,
  },
  quality_verification: {
    id: "quality_verification",
    label: "Quality verification",
    stage: "verify",
    plannerGuidance: "Independent review of the finished deliverable; can send work back for revision. Always the final step.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 10,
  },
  review: {
    id: "review",
    label: "Review",
    stage: "verify",
    plannerGuidance: "Lightweight critique of a draft.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 2,
  },
};

export function isCapabilityId(value: string): value is CapabilityId {
  return (CAPABILITY_IDS as readonly string[]).includes(value);
}

export function capabilitySpec(id: string): CapabilitySpec | undefined {
  return isCapabilityId(id) ? CAPABILITY_CATALOG[id] : undefined;
}

export const REPORT_CAPABILITIES: readonly CapabilityId[] = ["report_generation", "writing", "summarization"];
export const REVIEW_CAPABILITIES: readonly CapabilityId[] = ["quality_verification", "review"];

// Capabilities that may fetch live web data (directly or as a fallback when no
// upstream research exists) - the dashboard shows a web node for these.
export const WEB_CAPABLE_CAPABILITIES: ReadonlySet<string> = new Set(
  CAPABILITY_IDS.filter((c) => CAPABILITY_CATALOG[c].tools.includes("web_search")),
);
