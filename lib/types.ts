export interface TaskRecord {
  id: string;
  prompt: string;
  budget: number;
  remainingBudget: number;
  qualityThreshold: number;
  status: string;
  finalOutput: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks?: SubtaskRecord[];
  centralEscrow?: { totalLocked: number; totalReleased: number; totalRefunded: number } | null;
}

export interface SubtaskRecord {
  id: string;
  taskId: string;
  type: string;
  requiredCapability: string;
  status: string;
  sequence: number;
  assignedAgentId: string | null;
  assignedAgent?: AgentRecord | null;
  attemptCount: number;
  maxAttempts: number;
  output: string | null;
  qaScore: number | null;
  qaReason: string | null;
  bids?: { agentId: string; amount: number }[];
}

export interface AgentRecord {
  id: string;
  name: string;
  capabilities: string[];
  price: number;
  status: "ACTIVE" | "INACTIVE" | "REVOKED";
  reputation: number;
  successRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgCost: number;
  totalJobs: number;
}

export interface CentralLedgerRecord {
  id: string;
  taskId: string;
  amount: number;
  purpose: string;
  type: string;
  status: "APPROVED" | "BLOCKED";
  reason: string | null;
  timestamp: string;
  fromWallet: { id: string; type: string };
  toWallet: { id: string; type: string };
}
