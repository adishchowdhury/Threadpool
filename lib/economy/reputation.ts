import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";

// Deterministic reputation recompute from an agent's full AgentPerformance
// history. Called after every subtask completion (success or failure) —
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
  await prisma.agentPerformance.create({
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

  const history = await prisma.agentPerformance.findMany({ where: { agentId: params.agentId } });
  const totalJobs = history.length;
  const successCount = history.filter((h) => h.success).length;
  const successRate = totalJobs > 0 ? successCount / totalJobs : 0;
  const avgQuality = totalJobs > 0 ? history.reduce((s, h) => s + h.qaScore, 0) / totalJobs : 0;
  const avgLatencyMs = totalJobs > 0 ? history.reduce((s, h) => s + h.actualLatencyMs, 0) / totalJobs : 0;
  const avgCost = totalJobs > 0 ? history.reduce((s, h) => s + h.actualCost, 0) / totalJobs : 0;

  // Reputation: weighted blend of success rate and average quality, scaled 0-100.
  const reputation = Math.round(successRate * 50 + (avgQuality / 100) * 50);

  await prisma.agent.update({
    where: { id: params.agentId },
    data: { totalJobs, successCount, successRate, avgQuality, avgLatencyMs, avgCost, reputation },
  });

  await emitEvent(prisma, {
    taskId: params.taskId,
    actor: "system",
    eventType: "REPUTATION_UPDATED",
    payload: { agentId: params.agentId, reputation, successRate, avgQuality },
  });
}
