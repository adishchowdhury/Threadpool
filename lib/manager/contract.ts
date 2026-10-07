import type { DataSensitivity } from "@/lib/discovery/access";

// Task contract: what "successfully completed" means, fixed BEFORE any agent
// is hired and checked deterministically AFTER execution. Built from the
// plan and the user's constraints - no model decides whether it was met.

export interface ContractRequirement {
  subtaskType: string;
  capability: string;
  description: string;
}

export interface TaskContract {
  objective: string;
  requirements: ContractRequirement[];
  qualityThreshold: number;
  budget: number;
  deadlineAt: string | null;
  dataSensitivity: DataSensitivity;
  // True when the plan includes retrieval, so critical claims are expected
  // to be backed by retrieved sources.
  evidenceRequired: boolean;
}

const EVIDENCE_CAPABILITIES = ["web_research", "data_extraction"];

export function buildTaskContract(params: {
  objective: string;
  subtasks: { type: string; requiredCapability: string; description?: string | null }[];
  qualityThreshold: number;
  budget: number;
  deadline: Date | null;
  dataSensitivity: DataSensitivity;
}): TaskContract {
  return {
    objective: params.objective,
    requirements: params.subtasks.map((s) => ({ subtaskType: s.type, capability: s.requiredCapability, description: s.description ?? s.type })),
    qualityThreshold: params.qualityThreshold,
    budget: params.budget,
    deadlineAt: params.deadline ? params.deadline.toISOString() : null,
    dataSensitivity: params.dataSensitivity,
    evidenceRequired: params.subtasks.some((s) => EVIDENCE_CAPABILITIES.includes(s.requiredCapability)),
  };
}

export interface ContractEvaluation {
  requirementsCompleted: number;
  requirementsTotal: number;
  qualityScore: number;
  qualityMet: boolean;
  budgetUsed: number;
  budgetMet: boolean;
  deadlineMet: boolean | null; // null = no deadline set
  evidenceMet: boolean | null; // null = evidence not required
  sourceCount: number;
  satisfied: boolean;
  unmet: string[];
}

export function evaluateContract(
  contract: TaskContract,
  outcome: {
    subtasks: { type: string; status: string }[];
    qualityScore: number; // final review score, or mean subtask QA when no review ran
    budgetUsed: number;
    finishedAt: Date;
    sourceCount: number;
  },
): ContractEvaluation {
  const done = new Set(outcome.subtasks.filter((s) => s.status === "DONE").map((s) => s.type));
  const completed = contract.requirements.filter((r) => done.has(r.subtaskType));
  const unmet: string[] = contract.requirements.filter((r) => !done.has(r.subtaskType)).map((r) => `requirement not completed: ${r.subtaskType}`);

  const qualityMet = outcome.qualityScore >= contract.qualityThreshold;
  if (!qualityMet) unmet.push(`quality ${Math.round(outcome.qualityScore)} below threshold ${contract.qualityThreshold}`);

  const budgetMet = outcome.budgetUsed <= contract.budget;
  if (!budgetMet) unmet.push(`budget exceeded: ${outcome.budgetUsed} > ${contract.budget}`);

  const deadlineMet = contract.deadlineAt ? outcome.finishedAt.getTime() <= new Date(contract.deadlineAt).getTime() : null;
  if (deadlineMet === false) unmet.push("deadline missed");

  const evidenceMet = contract.evidenceRequired ? outcome.sourceCount > 0 : null;
  if (evidenceMet === false) unmet.push("evidence required but no sources were retrieved");

  return {
    requirementsCompleted: completed.length,
    requirementsTotal: contract.requirements.length,
    qualityScore: Math.round(outcome.qualityScore),
    qualityMet,
    budgetUsed: outcome.budgetUsed,
    budgetMet,
    deadlineMet,
    evidenceMet,
    sourceCount: outcome.sourceCount,
    satisfied: unmet.length === 0,
    unmet,
  };
}
