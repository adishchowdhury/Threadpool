import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";
import type { DiscoverableAgent } from "@/lib/discovery/types";

// Deterministic bidding: each capable, active agent bids its registry price.
// Kept deterministic (not a per-agent Gemini call) so the bidding step is
// fast and demo-reliable; the registry price already encodes the agent's
// "ask", which is realistic enough for the MVP marketplace.
export async function collectBids(params: {
  taskId: string;
  subtaskId: string;
  candidates: DiscoverableAgent[];
}) {
  const bids = new Map<string, number>();

  for (const agent of params.candidates) {
    const proposal = `I can deliver ${agent.capabilities.join(", ")} for this subtask.`;
    const bid = await prisma.bid.create({
      data: {
        subtaskId: params.subtaskId,
        agentId: agent.id,
        amount: agent.price,
        proposal,
      },
    });
    bids.set(agent.id, bid.amount);

    await emitEvent(prisma, {
      taskId: params.taskId,
      actor: agent.id,
      eventType: "BID_RECEIVED",
      payload: { agentId: agent.id, subtaskId: params.subtaskId, amount: bid.amount },
    });
  }

  return bids;
}
