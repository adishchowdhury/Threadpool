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
  "risk_assessment",
  "regulatory_compliance",
  "due_diligence",
  "industry_benchmarking",
  "forecasting",
  "sentiment_analysis",
  "legal_analysis",
  "seo_research",
  "pricing_strategy",
  "customer_research",
  "fact_checking",
  "editing",
  "translation",
  "presentation_design",
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
    plannerGuidance: "Financial metrics, unit economics, valuation views and investment cases. Every metric is labeled observed (from a cited source) or estimate (with its assumption ledger) and given a deterministic confidence level - never a single invented precise figure.",
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
  risk_assessment: {
    id: "risk_assessment",
    label: "Risk assessment",
    stage: "analyze",
    plannerGuidance:
      "Identify and rate the market, execution, financial and regulatory risks to the decision (likelihood, impact, mitigation). Use when the task asks about risk, downside, what could go wrong, or is otherwise a decision/investment case that needs an explicit risk section grounded in evidence rather than boilerplate caveats.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 5,
  },
  regulatory_compliance: {
    id: "regulatory_compliance",
    label: "Regulatory & compliance",
    stage: "analyze",
    plannerGuidance:
      "Identify applicable regulations, licensing requirements and compliance obligations (e.g. fintech/financial-services rules, data protection, sector-specific licensing) and their impact on the opportunity. Use when the task involves a regulated industry, mentions compliance/licensing, or names jurisdictions with regulatory exposure.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 4,
  },
  due_diligence: {
    id: "due_diligence",
    label: "Due diligence",
    stage: "gather",
    plannerGuidance:
      "Verify claims about a specific named company/deal (founders, funding history, legal standing, red flags) against citable sources before analysis relies on them. Use when the task names a specific company/deal to vet or asks for background/red-flag checks.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 6,
  },
  industry_benchmarking: {
    id: "industry_benchmarking",
    label: "Industry benchmarking",
    stage: "analyze",
    plannerGuidance:
      "Compare a company or segment's metrics against industry-typical benchmarks (margins, growth, multiples, headcount ratios). Use when the task asks how something compares to 'industry average' or peers generally, as opposed to named competitors (see competitive_analysis).",
    tools: ["upstream_lookup", "analyze_data", "calculate"],
    webGrounded: false,
    budgetPriority: 5,
  },
  forecasting: {
    id: "forecasting",
    label: "Forecasting",
    stage: "analyze",
    plannerGuidance:
      "Project forward from historical/observed figures (revenue, growth, demand) with an explicit method and assumptions, given as a range rather than a false-precision point estimate. Use when the task asks to project, forecast, or estimate future values.",
    tools: ["upstream_lookup", "calculate"],
    webGrounded: false,
    budgetPriority: 5,
  },
  sentiment_analysis: {
    id: "sentiment_analysis",
    label: "Sentiment analysis",
    stage: "analyze",
    plannerGuidance:
      "Gauge public, customer or investor sentiment from reviews, social commentary or press coverage. Use when the task asks about brand perception, customer sentiment, or public reaction.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 4,
  },
  legal_analysis: {
    id: "legal_analysis",
    label: "Legal analysis",
    stage: "analyze",
    plannerGuidance:
      "Identify legal structuring, contract, IP or liability considerations, distinct from regulatory licensing (see regulatory_compliance). Use when the task involves legal structuring, IP, liability or contract questions.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 4,
  },
  seo_research: {
    id: "seo_research",
    label: "SEO research",
    stage: "gather",
    plannerGuidance:
      "Live search for keyword demand, search intent and ranking competition for a topic or product. Use when the task asks about search visibility, keywords, or organic traffic opportunity.",
    tools: ["web_search"],
    webGrounded: false,
    budgetPriority: 3,
  },
  pricing_strategy: {
    id: "pricing_strategy",
    label: "Pricing strategy",
    stage: "analyze",
    plannerGuidance: "Recommend a pricing model and level using gathered competitor and cost data, with the tradeoffs made explicit. Use when the task asks how to price a product or service.",
    tools: ["upstream_lookup", "calculate"],
    webGrounded: false,
    budgetPriority: 5,
  },
  customer_research: {
    id: "customer_research",
    label: "Customer research",
    stage: "gather",
    plannerGuidance:
      "Gather customer/user needs, pain points and buying criteria from live sources (reviews, forums, coverage of surveys). Use when the task needs voice-of-customer input rather than market-level structure.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 6,
  },
  fact_checking: {
    id: "fact_checking",
    label: "Fact checking",
    stage: "verify",
    plannerGuidance:
      "Independently re-verify specific factual claims in a draft against citable sources, separate from the general quality_verification review. Use when the task or draft contains claims that must be checked rather than merely judged for quality.",
    tools: ["web_search", "upstream_lookup"],
    webGrounded: true,
    budgetPriority: 3,
  },
  editing: {
    id: "editing",
    label: "Editing",
    stage: "verify",
    plannerGuidance:
      "Line-edit a draft for clarity, tone, grammar and structure without changing its substantive claims. Use when the task asks to polish, proofread or tighten existing prose rather than critique its content.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 2,
  },
  translation: {
    id: "translation",
    label: "Translation",
    stage: "synthesize",
    plannerGuidance: "Translate a finished or draft deliverable into another language, preserving figures and structure. Use only when the task explicitly asks for output in a different language.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 2,
  },
  presentation_design: {
    id: "presentation_design",
    label: "Presentation design",
    stage: "synthesize",
    plannerGuidance:
      "Turn findings into a slide-style outline (one idea per slide, headline plus supporting bullets) instead of prose. Use when the task asks for a deck, slides, or pitch rather than a written report.",
    tools: ["upstream_lookup"],
    webGrounded: false,
    budgetPriority: 9,
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
