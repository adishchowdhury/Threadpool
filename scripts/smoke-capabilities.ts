// Live smoke test of the capability runtimes (real Sarvam + live web), with
// no database writes: plans a task, then runs web research -> competitive
// analysis -> data analysis with results flowing between them, QA'ing each.
//   npx tsx --env-file=.env scripts/smoke-capabilities.ts ["task prompt"]
import { decomposeTask } from "@/lib/manager/planner";
import { executeSubtask } from "@/lib/manager/worker";
import { verifySubtaskOutput } from "@/lib/manager/qa";
import type { UpstreamItem } from "@/lib/capabilities/types";
import type { Source } from "@/lib/capabilities/sources";

const prompt = process.argv[2] ?? "Analyze the Indian EV market and compare the top 5 companies.";

async function step(capability: string, description: string, upstream: UpstreamItem[], knownSources: Source[], sequence: number) {
  const t0 = Date.now();
  const exec = await executeSubtask({ type: capability, description, taskPrompt: prompt, upstream, knownSources });
  const qa = await verifySubtaskOutput({
    type: capability,
    description,
    output: exec.output,
    qualityThreshold: 80,
    artifacts: exec.artifacts,
    knownSources: [...knownSources, ...(exec.artifacts?.sources ?? [])],
  });
  console.log(`\n━━━ ${capability} (${((Date.now() - t0) / 1000).toFixed(1)}s, source=${exec.source}, mode=${exec.artifacts?.mode})`);
  if (exec.artifacts?.webSearch) console.log(`queries: ${JSON.stringify(exec.artifacts.webSearch.queries)}${exec.artifacts.webSearch.reason ? ` (${exec.artifacts.webSearch.reason})` : ""}`);
  console.log(`tools: ${(exec.artifacts?.toolCalls ?? []).map((c) => `${c.tool}[${c.ok ? "ok" : "fail"}: ${c.summary}${c.error ? ` - ${c.error}` : ""}]`).join(", ") || "none"}`);
  if (exec.artifacts?.citationCheck) console.log(`citations: ${JSON.stringify(exec.artifacts.citationCheck)}`);
  if (exec.artifacts?.ungroundedNumbers) console.log(`ungrounded numbers: ${JSON.stringify(exec.artifacts.ungroundedNumbers)}`);
  if (exec.artifacts?.competitors) console.log(`competitors: ${exec.artifacts.competitors.map((c) => `${c.name}(${c.evidence.join(",") || "-"})`).join(", ")}`);
  if (exec.artifacts?.dataPoints) console.log(`dataPoints: ${exec.artifacts.dataPoints.length} (${exec.artifacts.dataPoints.filter((d) => d.basis === "sourced").length} verified-sourced)`);
  console.log(`QA: ${qa.verdict.passed ? "PASS" : "FAIL"} ${qa.verdict.score} (${qa.source}) - ${qa.verdict.reason.slice(0, 300)}`);
  console.log("─── output (first 2500 chars) ───\n" + exec.output.slice(0, 2500));
  const item: UpstreamItem = { sequence, type: capability, capability, output: exec.output, artifacts: exec.artifacts };
  return { item, sources: exec.artifacts?.sources ?? [] };
}

async function main() {
  const planned = await decomposeTask({ prompt, budget: 50, qualityThreshold: 80 });
  console.log(`PLAN (${planned.source}):`);
  for (const s of planned.plan.subtasks) console.log(`  ${s.sequence}. ${s.requiredCapability.padEnd(22)} <- [${s.dependsOnSequence.join(",")}]  ${s.description.slice(0, 110)}`);
  if (planned.adjustments.length) console.log(`  normalization: ${planned.adjustments.join("; ")}`);

  const web = await step("web_research", `Find current, citable facts about: ${prompt}`, [], [], 0);
  const comp = await step("competitive_analysis", "Compare the top 5 companies: positioning, pricing, features, comparable metrics, SWOT.", [web.item], web.sources, 1);
  const known = [...web.sources, ...comp.sources];
  await step("data_analysis", "Rank the companies on the comparable metrics and compute shares and concentration.", [web.item, comp.item], known, 2);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
