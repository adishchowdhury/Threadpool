import { REPORT_CAPABILITIES as REPORT_CAPS, REVIEW_CAPABILITIES as REVIEW_CAPS } from "@/lib/capabilities/catalog";

// Picks the deliverable out of a finished workflow. The report a person reads
// is the output of the workflow's report-writing worker (which was given every
// upstream output as evidence) - not a dump of every worker's raw notes. The
// raw outputs stay available separately as "workforce outputs".

interface SubtaskLike {
  type: string;
  requiredCapability: string;
  sequence: number;
  output: string | null;
  qaScore: number | null;
  attemptCount: number;
  assignedAgentId: string | null;
}

const REPORT_CAPABILITIES: readonly string[] = REPORT_CAPS;
const REVIEW_CAPABILITIES: readonly string[] = REVIEW_CAPS;

export interface WorkerOutput {
  type: string;
  capability: string;
  agentId: string | null;
  agentName: string | null;
  qaScore: number | null;
  attempts: number;
  output: string;
}

export function buildFinalReport(subtasks: SubtaskLike[], agentNames: Map<string, string>) {
  const ordered = [...subtasks].sort((a, b) => a.sequence - b.sequence);
  const withOutput = ordered.filter((s) => s.output && s.output.trim());

  const reportSubtask =
    [...withOutput].reverse().find((s) => REPORT_CAPABILITIES.includes(s.requiredCapability)) ??
    [...withOutput].reverse().find((s) => !REVIEW_CAPABILITIES.includes(s.requiredCapability));

  // No report-writing step in this plan: fall back to the worker outputs in
  // order, but keep any reviewer commentary out of the main body.
  const content = reportSubtask
    ? (reportSubtask.output as string).trim()
    : withOutput
        .filter((s) => !REVIEW_CAPABILITIES.includes(s.requiredCapability))
        .map((s) => (s.output as string).trim())
        .join("\n\n");

  const workerOutputs: WorkerOutput[] = ordered.map((s) => ({
    type: s.type,
    capability: s.requiredCapability,
    agentId: s.assignedAgentId,
    agentName: s.assignedAgentId ? (agentNames.get(s.assignedAgentId) ?? null) : null,
    qaScore: s.qaScore,
    attempts: s.attemptCount,
    output: s.output ?? "",
  }));

  return { content, reportType: reportSubtask?.type ?? null, workerOutputs };
}
