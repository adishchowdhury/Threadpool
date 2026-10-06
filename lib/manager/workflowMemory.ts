import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";

function significantWords(text: string): string[] {
  const stop = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "is", "are"]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    ),
  );
}

// A past workflow counts as "similar" only above this word-overlap score.
// Below it the match is coincidental and would mislead the user.
export const MIN_REUSE_SIMILARITY = 0.5;

// Deterministic similarity: word-overlap (Jaccard) over prior task prompts -
// no neural network, just ranking. Good enough to demonstrate "Kraven
// recalls a similar past workflow."
export async function findSimilarWorkflow(taskType: string, prompt: string) {
  const candidates = await db.workflowMemory.findMany({
    where: { taskType, success: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  if (candidates.length === 0) return null;

  const targetWords = new Set(significantWords(prompt));
  let best: { memory: (typeof candidates)[number]; similarity: number } | null = null;

  for (const memory of candidates) {
    const words = new Set<string>(JSON.parse(memory.taskFeatures) as string[]);
    const intersection = [...targetWords].filter((w) => words.has(w)).length;
    const union = new Set([...targetWords, ...words]).size;
    const similarity = union > 0 ? intersection / union : 0;
    if (!best || similarity > best.similarity) best = { memory, similarity };
  }

  return best && best.similarity >= MIN_REUSE_SIMILARITY ? best : null;
}

export async function storeWorkflow(params: {
  taskId: string;
  taskType: string;
  prompt: string;
  subtaskTypes: string[];
  agentsUsed: string[];
  sequence: string[];
  dependencies: Record<string, string[]>;
  cost: number;
  latencyMs: number;
  quality: number;
  success: boolean;
}) {
  await db.workflowMemory.create({
    data: {
      taskType: params.taskType,
      taskFeatures: JSON.stringify(significantWords(params.prompt)),
      subtasks: JSON.stringify(params.subtaskTypes),
      agentsUsed: JSON.stringify(params.agentsUsed),
      sequence: JSON.stringify(params.sequence),
      dependencies: JSON.stringify(params.dependencies),
      cost: params.cost,
      latencyMs: params.latencyMs,
      quality: params.quality,
      success: params.success,
    },
  });

  await emitEvent(db, {
    taskId: params.taskId,
    actor: "system",
    eventType: "WORKFLOW_MEMORY_STORED",
    payload: { taskType: params.taskType, agentsUsed: params.agentsUsed, cost: params.cost, quality: params.quality },
  });
}
