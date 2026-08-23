import { NextResponse } from "next/server";
import { PromptOptimizationRouter } from "@/lib/optimizer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "Invalid prompt argument" }, { status: 400 });
    }

    const router = new PromptOptimizationRouter();
    const start = Date.now();
    const optimized = await router.optimize({ prompt: body.prompt });
    const latency = Date.now() - start;

    const modelName = process.env.PROMPT_MODEL_ENABLED === "false" ? "gemini" : "qwen2.5-0.5b-instruct";
    const provider = process.env.PROMPT_MODEL_ENABLED === "false" ? "gemini" : "local";

    return NextResponse.json({
      optimizedTask: optimized,
      model: modelName,
      provider: provider,
      latencyMs: latency
    });
  } catch (err: any) {
    console.error("[Prompt Optimizer Route] Error during optimization:", err);
    return NextResponse.json({ error: err.message || "Failed to optimize prompt" }, { status: 500 });
  }
}
