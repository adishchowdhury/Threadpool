import { NextResponse } from "next/server";
import { z } from "zod";
import { isSarvamConfigured } from "@/lib/manager/sarvam";
import { generateWithReasoningGuard } from "@/lib/capabilities/llm";

const requestSchema = z.object({
  taskId: z.string(),
  subtaskId: z.string(),
  capability: z.string(),
  prompt: z.string(),
  constraints: z.object({ budget: z.number(), deadline: z.string().nullable().optional() }),
});

function staticOutput(capability: string, prompt: string): string {
  return (
    `[EXTERNAL DEMO AGENT - static fallback, no model configured]\n\n` +
    `## ${capability.replace(/_/g, " ").toUpperCase()}\n\n` +
    `Task: ${prompt}\n\n` +
    `This deliverable was produced by Kraven's bundled reference external agent, a stand-in third-party HTTP ` +
    `service used to demonstrate the real external-agent contract (health check, authenticated execution request, ` +
    `structured response) without requiring a second deployment. A genuine provider's endpoint would return substantive ` +
    `${capability.replace(/_/g, " ")} content here instead of this notice.`
  );
}

// Reference implementation of the execution half of Kraven's external agent
// contract - a genuinely separate HTTP endpoint, reached through the same
// fetch/timeout/SSRF/auth path as any real provider. To make the demo
// convincing (and pass the same independent QA every other agent faces) it
// does real work when a model is available (reusing Kraven's own Sarvam
// credentials here is fine: Kraven's router/execution/QA treat it exactly
// like any other opaque HTTP agent and never know or care what's behind the
// endpoint - that's precisely what a real provider's own agent would do with
// their own model credentials). Falls back to a clearly-labeled static
// placeholder if no model is configured, so this endpoint never 500s.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ status: "failed", error: "malformed request payload" }, { status: 400 });
  }
  const { capability, prompt } = parsed.data;

  if (!isSarvamConfigured()) {
    return NextResponse.json({ status: "completed", output: staticOutput(capability, prompt), metadata: { mode: "static_fallback" } });
  }

  try {
    const { text, usage } = await generateWithReasoningGuard({
      tier: "standard",
      system:
        "You are an independent third-party AI agent reachable over HTTP, hired for this one task. Deliver only the requested deliverable in clean markdown - no preamble, no mention of being an AI.",
      prompt: `Capability: ${capability.replace(/_/g, " ")}\nTask: ${prompt}\n\nProduce a concise, substantive deliverable for this capability.`,
    });
    if (!text) return NextResponse.json({ status: "completed", output: staticOutput(capability, prompt), metadata: { mode: "static_fallback" } });
    return NextResponse.json({ status: "completed", output: text, metadata: { mode: "model", tokens: usage.inputTokens + usage.outputTokens } });
  } catch (err) {
    console.error("[demo-external-agent] generation failed, using static fallback", err);
    return NextResponse.json({ status: "completed", output: staticOutput(capability, prompt), metadata: { mode: "static_fallback" } });
  }
}
