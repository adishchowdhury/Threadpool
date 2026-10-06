import type { Source, CitationCheck } from "@/lib/capabilities/sources";
import type { AnalysisResult, Dataset } from "@/lib/tools/dataEngine";
import type { ToolCallRecord } from "@/lib/tools/types";
import type { NumericCheckReport } from "@/lib/manager/numericCheck";

// Structured artifacts a subtask leaves behind next to its prose output.
// Persisted on the Subtask row (JSON) so downstream workers, QA, the
// integration review and the final report work from data, not by re-parsing
// prose.

export interface CompetitorProfile {
  name: string;
  positioning: string;
  pricing: string;
  keyFeatures: string[];
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  // Source ids ([S#]) backing this profile; only retrieved ids survive.
  evidence: string[];
}

export interface Swot {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface DataPoint {
  entity: string;
  metric: string;
  value: number;
  unit: string | null;
  period: string | null;
  basis: "sourced" | "estimate";
  sourceId: string | null;
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  // Which workflow step must fix it (by plan sequence number), or null when
  // the reviewer cannot attribute it.
  targetSequence: number | null;
  category: string;
  description: string;
  fix: string;
  // Set by Kraven's deterministic checks (not the reviewer model).
  origin?: "reviewer" | "citation_check" | "numeric_check";
}

export interface IntegrationReview {
  approved: boolean;
  score: number;
  summary: string;
  issues: ReviewIssue[];
}

export interface SubtaskArtifacts {
  // Sources this subtask itself retrieved (registered with task-wide ids).
  sources?: Source[];
  webSearch?: { available: boolean; queries: string[]; reason?: string };
  citationCheck?: CitationCheck;
  competitors?: CompetitorProfile[];
  swot?: Swot;
  dataPoints?: DataPoint[];
  datasets?: Dataset[];
  analysis?: AnalysisResult[];
  ungroundedNumbers?: string[];
  review?: IntegrationReview;
  // Deterministic numeric check of the report the review looked at, and that
  // report's hash, so the final report can reuse it when unchanged.
  numericCheck?: NumericCheckReport;
  reviewedReportHash?: string;
  toolCalls?: ToolCallRecord[];
  // How the deliverable was produced, for honest labeling.
  mode?: "structured" | "freeform" | "deterministic" | "fallback";
}

export interface UpstreamItem {
  subtaskId?: string;
  sequence?: number;
  type: string;
  capability?: string;
  output: string;
  artifacts?: SubtaskArtifacts;
}

export interface CapabilityRunInput {
  capability: string;
  description: string;
  taskPrompt: string;
  feedback?: string;
  upstream: UpstreamItem[];
  // Every source registered earlier in this task (for id allocation and
  // citation checks).
  knownSources: Source[];
  taskId?: string;
  subtaskId?: string;
  agentId?: string;
  agent: { tier: string | null; systemPrompt: string | null } | null;
  webGrounding: boolean;
}

export interface CapabilityRunOutput {
  output: string;
  source: string;
  usage?: { inputTokens: number; outputTokens: number };
  artifacts: SubtaskArtifacts;
}
