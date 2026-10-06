// Classifies what KIND of decision report the task needs, so the final
// report step gets a structure suited to the task (CLAUDE.md "differentiate
// by task type") instead of one fixed template forced onto everything.
// Deterministic (regex-based) and cheap - no extra model call.

export type ReportIntent =
  | "investment_analysis"
  | "market_research"
  | "vendor_selection"
  | "competitive_analysis"
  | "due_diligence"
  | "general_decision"
  | "general";

const SIGNALS: Array<{ intent: ReportIntent; test: RegExp }> = [
  { intent: "vendor_selection", test: /\b(vendor|supplier|which (tool|platform|provider)|select(ing)? a|choose between|procure(ment)?|rfp\b)\b/i },
  { intent: "due_diligence", test: /\b(due diligence|red flags?|risk assessment|background check|investigat\w* (this|the) (company|deal))\b/i },
  { intent: "investment_analysis", test: /\b(invest\w*|valuation|thesis|fund(ing)?|portfolio|should (we|i) (buy|invest|fund)|acquisition)\b/i },
  { intent: "competitive_analysis", test: /\b(competitor\w*|competitive landscape|vs\.?|versus|compare|benchmark against)\b/i },
  { intent: "market_research", test: /\b(market (size|research|analysis|segment)|tam\b|industry (analysis|overview)|sector)\b/i },
];

// Capabilities that, when present together, mark a report as a DECISION
// (not just an FYI summary) - the point where evidence/assumptions/
// confidence/scorecard matter most.
const DECISION_CAPABILITIES = new Set([
  "financial_analysis",
  "market_research",
  "competitive_analysis",
  "data_analysis",
  "risk_assessment",
  "regulatory_compliance",
]);

export function classifyReportIntent(taskPrompt: string, capabilitiesUsed: string[]): ReportIntent {
  for (const s of SIGNALS) if (s.test.test(taskPrompt)) return s.intent;
  if (capabilitiesUsed.some((c) => DECISION_CAPABILITIES.has(c))) return "general_decision";
  return "general";
}

export function isDecisionIntent(intent: ReportIntent): boolean {
  return intent !== "general";
}

interface Template {
  sections: string[];
  guidance: string;
}

// Each template is an Executive Decision Brief variant - the same
// epistemic rigor (fact vs. estimate vs. assumption, evidence-linked
// claims, confidence, what would change the recommendation), restructured
// per task type rather than forcing e.g. a vendor comparison into an
// "investment thesis" shape.
const TEMPLATES: Record<ReportIntent, Template> = {
  investment_analysis: {
    sections: [
      "## Bottom Line",
      "## Decision Scorecard",
      "## Key Findings",
      "## Evidence",
      "## Market & Competitive Context",
      "## Financial Analysis",
      "## Scenarios",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance:
      "This is an investment-style brief. The Decision Scorecard compares the candidate segments/options with weighted factors (growth, competition, regulatory risk, capital intensity, willingness to pay, etc.) and a transparent total score - state the weights. Financial Analysis must separate observed figures, estimates and assumptions (use the assumption ledger format below) rather than presenting one blended number. Distinguish business quality from investment attractiveness from price/valuation attractiveness - a strong business can still be a bad investment at the wrong price. State the decision threshold where the evidence supports one (e.g. 'attractive below $X valuation' or 'the case breaks if CAC exceeds $Y').",
  },
  market_research: {
    sections: [
      "## Bottom Line",
      "## Key Findings",
      "## Market Segments",
      "## Evidence",
      "## Sizing & Metrics",
      "## Scenarios",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance:
      "Focus on market structure, segmentation and sizing. Where sources disagree on a figure (e.g. market size), state the range and Kraven's working estimate, not a single invented point figure.",
  },
  vendor_selection: {
    sections: [
      "## Bottom Line",
      "## Decision Scorecard",
      "## Requirements Compared",
      "## Evidence",
      "## Pricing & Tradeoffs",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance:
      "The Decision Scorecard is a weighted comparison of the candidate options against the user's stated or implied requirements. State the weights and why the winner ranked first. Alternatives must include the non-obvious ones: do nothing / keep the status quo, and build in-house, not just the other vendors.",
  },
  competitive_analysis: {
    sections: [
      "## Bottom Line",
      "## Competitor Matrix",
      "## Key Findings",
      "## Evidence",
      "## Differentiation & Threats",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance: "Lead with how the subject is positioned against named competitors; carry through any structured comparables already computed upstream.",
  },
  due_diligence: {
    sections: [
      "## Bottom Line",
      "## Key Findings",
      "## Evidence",
      "## Red Flags",
      "## Missing Information",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance: "Be explicit about what could NOT be verified (Missing Information) - that gap is itself a finding, not something to paper over.",
  },
  general_decision: {
    sections: [
      "## Bottom Line",
      "## Key Findings",
      "## Evidence",
      "## Analysis",
      "## Alternatives",
      "## Risks",
      "## Why This Could Be Wrong",
      "## What Could Change This Recommendation",
      "## Confidence",
      "## Methodology",
    ],
    guidance: "Quantitative claims need an epistemic status (observed/estimate/assumption) and, where relevant, a confidence level - do not present an estimate as a verified fact.",
  },
  general: {
    sections: ["## Executive Summary", "## Key Points", "## Recommendation"],
    guidance: "This is a lighter deliverable (no quantitative market/financial/competitive analysis ran) - keep it concise; the full decision-brief structure is unnecessary here.",
  },
};

export function reportTemplate(intent: ReportIntent): Template {
  return TEMPLATES[intent];
}
