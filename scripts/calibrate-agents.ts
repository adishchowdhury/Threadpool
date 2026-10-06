import { calibrateAgents } from "@/lib/agents/calibration";
import { seedRegistry } from "@/lib/db/reset";
import { disconnectMongoose } from "@/lib/db/mongoose";
import { db } from "@/lib/db/client";

async function main() {
  await seedRegistry();
  // Optional: calibrate only the given agent ids, e.g.
  //   npm run agents:calibrate -- webresearch-01 competitive-01
  const agentIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const runs = await calibrateAgents(agentIds.length ? { agentIds } : {});
  for (const r of runs) {
    console.log(
      r.status === "recorded"
        ? `${r.agentId.padEnd(18)} ${r.capability.padEnd(22)} qa=${r.qaScore} passed=${r.passed} ${r.latencyMs}ms`
        : `${r.agentId.padEnd(18)} ${r.capability.padEnd(22)} SKIPPED: ${r.reason}`,
    );
  }
  const agents = await db.agent.findMany({ orderBy: { name: "asc" } });
  console.log("\nagent                  samples quality success rep  latency  price");
  for (const a of agents) {
    console.log(`${a.name.padEnd(22)} ${String(a.sampleCount).padStart(3)}    ${a.avgQuality.toFixed(0).padStart(5)}  ${(a.successRate * 100).toFixed(0).padStart(5)}% ${String(a.reputation).padStart(3)}  ${(a.avgLatencyMs / 1000).toFixed(1).padStart(5)}s  ${a.price}t`);
  }
  await disconnectMongoose();
}
main().catch((e) => { console.error(e); process.exit(1); });
