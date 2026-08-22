import { prisma } from "@/lib/prisma";
import { ensureSystemWallets, ensureAgentWallet } from "@/lib/economy/wallets";

export const REGISTRY_AGENTS: Array<{
  id: string;
  name: string;
  capabilities: string[];
  price: number;
  endpoint: string;
  seedReputation: number;
  seedSuccessRate: number;
  seedAvgQuality: number;
  seedAvgLatencyMs: number;
}> = [
  {
    id: "researcher-01",
    name: "Atlas Researcher",
    capabilities: ["market_research", "data_extraction"],
    price: 4,
    endpoint: "/agents/research",
    seedReputation: 82,
    seedSuccessRate: 0.95,
    seedAvgQuality: 88,
    seedAvgLatencyMs: 9000,
  },
  {
    id: "researcher-02",
    name: "Beacon Insights",
    capabilities: ["market_research", "financial_analysis"],
    price: 6,
    endpoint: "/agents/research",
    seedReputation: 90,
    seedSuccessRate: 0.97,
    seedAvgQuality: 93,
    seedAvgLatencyMs: 12000,
  },
  {
    id: "analyst-01",
    name: "Ledger Analyst",
    capabilities: ["financial_analysis", "data_extraction"],
    price: 5,
    endpoint: "/agents/analyze",
    seedReputation: 85,
    seedSuccessRate: 0.93,
    seedAvgQuality: 89,
    seedAvgLatencyMs: 10000,
  },
  {
    id: "writer-01",
    name: "Writer",
    capabilities: ["writing", "report_generation"],
    price: 3,
    endpoint: "/agents/writer",
    seedReputation: 78,
    seedSuccessRate: 0.9,
    seedAvgQuality: 84,
    seedAvgLatencyMs: 7000,
  },
  {
    id: "writer-02",
    name: "Narrative Pro",
    capabilities: ["writing", "report_generation", "review"],
    price: 5,
    endpoint: "/agents/writer",
    seedReputation: 88,
    seedSuccessRate: 0.96,
    seedAvgQuality: 91,
    seedAvgLatencyMs: 8500,
  },
  {
    id: "summarizer-01",
    name: "Summarizer",
    capabilities: ["summarization"],
    price: 2,
    endpoint: "/agents/summarize",
    seedReputation: 75,
    seedSuccessRate: 0.92,
    seedAvgQuality: 80,
    seedAvgLatencyMs: 4000,
  },
  {
    id: "qa-01",
    name: "QA Sentinel",
    capabilities: ["quality_verification", "review"],
    price: 2,
    endpoint: "/agents/qa",
    seedReputation: 91,
    seedSuccessRate: 0.98,
    seedAvgQuality: 95,
    seedAvgLatencyMs: 5000,
  },
  {
    id: "local-fake-researcher",
    name: "[Local] Fake Research Bot",
    capabilities: ["market_research", "data_extraction"],
    price: 3,
    endpoint: "/agents/research",
    seedReputation: 70,
    seedSuccessRate: 0.85,
    seedAvgQuality: 80,
    seedAvgLatencyMs: 5000,
  },
  {
    id: "local-fake-analyst",
    name: "[Local] Fake Financial Bot",
    capabilities: ["financial_analysis"],
    price: 4,
    endpoint: "/agents/analyze",
    seedReputation: 72,
    seedSuccessRate: 0.88,
    seedAvgQuality: 82,
    seedAvgLatencyMs: 6000,
  },
  {
    id: "rogue-agent",
    name: "Rogue Agent",
    capabilities: ["unbounded_payment_request"],
    price: 10000,
    endpoint: "/agents/rogue",
    seedReputation: 0,
    seedSuccessRate: 0,
    seedAvgQuality: 0,
    seedAvgLatencyMs: 0,
  },
];

export async function seedRegistry() {
  await ensureSystemWallets();
  for (const a of REGISTRY_AGENTS) {
    await prisma.agent.upsert({
      where: { id: a.id },
      update: {
        name: a.name,
        capabilities: JSON.stringify(a.capabilities),
        price: a.price,
        endpoint: a.endpoint,
        status: "ACTIVE",
      },
      create: {
        id: a.id,
        name: a.name,
        capabilities: JSON.stringify(a.capabilities),
        price: a.price,
        endpoint: a.endpoint,
        status: "ACTIVE",
        reputation: a.seedReputation,
        successRate: a.seedSuccessRate,
        avgQuality: a.seedAvgQuality,
        avgLatencyMs: a.seedAvgLatencyMs,
        avgCost: a.price,
      },
    });
    await ensureAgentWallet(a.id);
  }
}

// Wipes all task/economy/event state and reseeds a clean registry + system
// wallets — used by `/api/reset` for repeatable, resettable judge demos.
export async function resetDatabase() {
  await prisma.$transaction([
    prisma.agentLedger.deleteMany(),
    prisma.centralLedger.deleteMany(),
    prisma.agentEscrow.deleteMany(),
    prisma.centralEscrow.deleteMany(),
    prisma.bid.deleteMany(),
    prisma.agentPerformance.deleteMany(),
    prisma.subtask.deleteMany(),
    prisma.securityEvent.deleteMany(),
    prisma.event.deleteMany(),
    prisma.task.deleteMany(),
    prisma.workflowMemory.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.agent.deleteMany(),
  ]);

  await seedRegistry();
}
