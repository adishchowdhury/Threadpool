import { LocalPromptOptimizer } from "../lib/optimizer/localOptimizer";
import fs from "fs";
import path from "path";

const BENCHMARK_PROMPTS = [
  "write a birthday message",
  "make a report on fintech",
  "compare Indian fintech companies",
  "find why our API is failing",
  "analyze whether our company should enter the EV market",
  "get the latest revenue of company X",
  "create a backend architecture for this application",
  "analyze this customer data and find anomalies"
];

async function runBenchmark() {
  console.log("=== MOMENTUM PROMPT OPTIMIZER BENCHMARK ===");
  
  const optimizer = new LocalPromptOptimizer();
  const results: any[] = [];
  
  let validJsonCount = 0;
  let totalLatency = 0;

  for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
    const prompt = BENCHMARK_PROMPTS[i];
    console.log(`\nEvaluating prompt [${i + 1}/${BENCHMARK_PROMPTS.length}]: "${prompt}"`);
    
    const start = Date.now();
    let success = false;
    let errorMsg = "";
    let output: any = null;

    try {
      output = await optimizer.optimize({ prompt });
      success = true;
      validJsonCount++;
    } catch (err: any) {
      errorMsg = err.message || "Unknown error";
    }
    
    const latency = Date.now() - start;
    totalLatency += latency;

    results.push({
      prompt,
      latencyMs: latency,
      success,
      error: errorMsg,
      output
    });

    if (success && output) {
      console.log(`✓ Success (${latency}ms)`);
      console.log(`  Objective: ${output.objective}`);
      console.log(`  Task Type: ${output.taskType}`);
      console.log(`  Capabilities: ${output.requiredCapabilities.join(", ")}`);
      console.log(`  Ambiguities: ${output.ambiguities.length} found`);
      console.log(`  Verification required: ${output.verificationRequirements?.required}`);
    } else {
      console.log(`✗ Failed: ${errorMsg}`);
    }
  }

  // Calculate final statistics
  const avgLatency = totalLatency / BENCHMARK_PROMPTS.length;
  const successRate = (validJsonCount / BENCHMARK_PROMPTS.length) * 100;

  const benchmarkReportPath = path.join(process.cwd(), "models", "benchmark-report.json");
  
  const report = {
    timestamp: new Date().toISOString(),
    model: "Qwen2.5-0.5B-Instruct",
    statistics: {
      totalPrompts: BENCHMARK_PROMPTS.length,
      successRatePercent: successRate,
      averageLatencyMs: avgLatency
    },
    results
  };

  fs.writeFileSync(benchmarkReportPath, JSON.stringify(report, null, 2));
  console.log(`\n=== BENCHMARK COMPLETED ===`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Average Latency: ${avgLatency.toFixed(1)}ms`);
  console.log(`Report written to ${benchmarkReportPath}`);
  
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
