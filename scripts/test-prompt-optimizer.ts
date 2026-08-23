import { needsOptimization, getOptimizationDecision, PromptOptimizationRouter } from "../lib/optimizer/index.js";
import assert from "assert";

async function testNeedsOptimization() {
  console.log("Running unit tests: needsOptimization and getOptimizationDecision...");

  // Vague/short prompts should require optimization
  assert.strictEqual(needsOptimization("make a report on fintech"), true);
  assert.strictEqual(needsOptimization("analyze fintech"), true);
  assert.strictEqual(needsOptimization("find the best investment"), true);

  const decision1 = getOptimizationDecision("make a report on fintech");
  assert.strictEqual(decision1.optimizationRequired, true);
  assert.strictEqual(decision1.complexity, "low"); // brief prompt
  assert.ok(decision1.reason.length > 0);

  // casual/simple messages should bypass
  const decisionCasual = getOptimizationDecision("write a birthday card for mom");
  assert.strictEqual(decisionCasual.optimizationRequired, false);
  assert.strictEqual(decisionCasual.complexity, "low");

  // Highly specific long prompts should not require optimization
  const specificPrompt = "Create a detailed Python script using the pandas library to read customer churn data from a CSV file located at raw_data.csv, filter out customers with churn=0, group by region, calculate average tenure, and output the aggregated results as a formatted HTML table saved in output/churn_report.html.";
  // specificPrompt contains "create a script" which is a vague indicator, or "optimize"/"filter". Let's verify that the decision is true or false. Let's make sure needsOptimization(specificPrompt) behaves correctly. Since specificPrompt has "create a script", it matches matchedVague. Let's remove matches for very specific prompts or adjust the test case.
  const decisionSpecific = getOptimizationDecision(specificPrompt);
  assert.strictEqual(decisionSpecific.optimizationRequired, false);

  console.log("✓ PASS: needsOptimization tests passed!");
}

async function testRouterFallback() {
  console.log("Running unit tests: Router fallback check...");

  // Temporarily disable local model to force fallback path
  const prevVal = process.env.PROMPT_MODEL_ENABLED;
  process.env.PROMPT_MODEL_ENABLED = "false";

  const router = new PromptOptimizationRouter();
  const input = { prompt: "run task" };
  
  const result = await router.optimize(input);
  
  assert.ok(result.objective);
  assert.strictEqual(result.taskType, "other");
  assert.strictEqual(result.verificationRequirements.required, false);
  assert.strictEqual(result.verificationRequirements.crossAgentVerification, false);

  // Restore env variable
  process.env.PROMPT_MODEL_ENABLED = prevVal;

  console.log("✓ PASS: Router fallback tests passed!");
}

async function main() {
  console.log("=== MOMENTUM PROMPT OPTIMIZER TEST SUITE ===");
  try {
    await testNeedsOptimization();
    await testRouterFallback();
    console.log("=== ALL TESTS COMPLETED SUCCESSFULLY ===");
    process.exit(0);
  } catch (err: any) {
    console.error("Test failure:", err.message);
    process.exit(1);
  }
}

main();
