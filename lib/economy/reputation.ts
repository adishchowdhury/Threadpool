import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { refreshAgentStats } from "@/lib/agents/stats";

// Deterministic reputation recompute (lib/agents/stats.ts) from everything
// observed about the agent - calibration runs plus job history. Called after every subtask completion (success or failure) -
// never mutated directly by an LLM.
export async function recordPerformanceAndUpdateReputation(params: {
  agentId: string;
  taskId: string;
  subtaskId: string;
  taskType: string;
  capabilities: string[];
  expectedCost: number;
  actualCost: number;
  expectedLatencyMs: number;
  actualLatencyMs: number;
  qaScore: number;
  success: boolean;
}) {
  await db.agentPerformance.create({
    data: {
      agentId: params.agentId,
      taskId: params.taskId,
      subtaskId: params.subtaskId,
      taskType: params.taskType,
      capabilities: JSON.stringify(params.capabilities),
      expectedCost: params.expectedCost,
      actualCost: params.actualCost,
      expectedLatencyMs: params.expectedLatencyMs,
      actualLatencyMs: params.actualLatencyMs,
      qaScore: params.qaScore,
      success: params.success,
    },
  });

  const stats = await refreshAgentStats(params.agentId);
  if (!stats) return;
  const { reputation, successRate, avgQuality } = stats;

  await emitEvent(db, {
    taskId: params.taskId,
    actor: "system",
    eventType: "REPUTATION_UPDATED",
    payload: { agentId: params.agentId, reputation, successRate, avgQuality },
  });
}
