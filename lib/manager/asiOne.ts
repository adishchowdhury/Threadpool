// ASI:One is Fetch.ai's OpenAI-compatible chat completions endpoint. Unlike
// raw Agentverse agents — which only speak an async Chat Protocol over a
// mailbox, requiring us to run our own registered uAgent process to send or
// receive anything — ASI:One exposes a normal synchronous HTTP endpoint
// that can route a request to a specific Agentverse agent (via its
// `agents` + `planner_mode` parameters) and hand back the answer in one
// request/response cycle. That's what makes it possible to call a real
// Agentverse agent from a plain Next.js API route.
const ASI1_BASE_URL = "https://api.asi1.ai/v1";

export function isAsiOneConfigured(): boolean {
  return Boolean(process.env.ASI1_API_KEY);
}

// Invokes a specific, previously-discovered Agentverse agent (by address)
// through ASI:One's planner-mode routing. Throws on any failure — callers
// are expected to catch and fall back, never to fabricate a reply.
export async function invokeAgentviaAsiOne(params: {
  agentAddress: string;
  agentName: string;
  instruction: string;
  taskPrompt: string;
}): Promise<{ output: string }> {
  const apiKey = process.env.ASI1_API_KEY;
  if (!apiKey) {
    throw new Error("ASI1_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${ASI1_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "asi1",
        messages: [
          {
            role: "user",
            content: `Overall task: "${params.taskPrompt}"\n\nYour specific instruction: ${params.instruction}\n\nProduce a concise, well-structured deliverable for exactly this subtask.`,
          },
        ],
        planner_mode: true,
        agents: [params.agentAddress],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ASI:One API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string") {
      throw new Error(`ASI:One response for agent ${params.agentName} had no message content`);
    }

    return { output: text };
  } finally {
    clearTimeout(timeout);
  }
}
