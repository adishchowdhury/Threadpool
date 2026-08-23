import { generateText } from "ai";
import { geminiModel, isGeminiConfigured, type GeminiModelTier } from "@/lib/manager/gemini";
import { authorizeX402Spend, finalizeX402Settlement, failX402Intent } from "@/lib/blockchain/x402";
import {
  getX402PayingFetch,
  isRealX402PayerConfigured,
  X402_ALGORAND_NETWORK,
  describeX402Failure,
  getX402SettleResponse,
} from "@/lib/blockchain/x402Algorand";
import { prisma } from "@/lib/prisma";
import { isAsiOneConfigured, invokeAgentviaAsiOne } from "@/lib/manager/asiOne";
import { gatherWebContext, formatWebContextForPrompt } from "@/lib/manager/webScraper";
import { emitEvent } from "@/lib/events/emit";

// Capabilities whose output benefits from grounding in current, post-training-cutoff
// data. Gemini's knowledge is frozen at training time; market sizing, funding, pricing
// and competitive-landscape facts drift, so these subtask types get a live web pass
// before the model call. Synthesis-only capabilities (writing, summarization, QA) are
// deliberately excluded — they should work from the upstream subtask outputs, not fetch
// more raw data on their own.
const WEB_GROUNDED_CAPABILITIES = new Set([
  "market_research",
  "financial_analysis",
  "data_extraction",
  "competitive_analysis",
]);

function fallbackOutput(params: { type: string; description: string; taskPrompt: string; feedback?: string }): string {
  const header = `[LOCAL FALLBACK OUTPUT — Gemini unavailable]`;
  const feedbackNote = params.feedback ? `\nAddressing prior QA feedback: ${params.feedback}` : "";
  return (
    `${header}\n\n` +
    `## ${params.type.replace(/_/g, " ").toUpperCase()}\n\n` +
    `Task: ${params.taskPrompt}\n` +
    `Instruction: ${params.description}${feedbackNote}\n\n` +
    `This is a deterministic placeholder result standing in for a real ${params.type} deliverable. ` +
    `It demonstrates the workflow's structure (input -> execution -> output) without a live model call. ` +
    `In a fully configured run, this section would contain substantive ${params.type.replace(/_/g, " ")} content ` +
    `addressing the task above in detail, with concrete figures, findings, and reasoning.`
  );
}

// Thin, constrained wrapper around a Gemini call — one fixed prompt shape
// per worker, so the demo path stays predictable. Falls back to a clearly
// labeled deterministic placeholder if Gemini is unconfigured or errors.
export async function executeSubtask(params: {
  type: string;
  description: string;
  taskPrompt: string;
  feedback?: string;
  taskId?: string;
  agentId?: string;
  subtaskId?: string;
}): Promise<{ output: string; actualLatencyMs: number; source: string }> {
  const start = Date.now();

  // If this is market research and we have taskId and agentId, route via the
  // real x402 payment flow: a genuine HTTP 402 -> sign -> verify -> settle
  // round trip against /api/x402/premium-market-research, using the official
  // @x402/* SDK (see lib/blockchain/x402Algorand.ts). The signed payment is a
  // real Algorand testnet USDC (ASA) transfer, verified and settled by a live
  // x402 facilitator — not a custom header scheme.
  const X402_PRICE_USD = 0.01;
  const X402_TOKEN_COST = 1; // demo conversion: $0.01 real USDC == 1 virtual task-budget token

  if (params.type === "market_research" && params.taskId && params.agentId) {
    if (!isRealX402PayerConfigured()) {
      console.warn("[x402 Flow] ALGOD_MNEMONIC/MANAGER_MNEMONIC not set — skipping real x402 flow, using regular research path");
    } else {
      const idempotencyKey = `idem_${params.taskId}_market_research_${params.agentId}`;
      let intentId: string | null = null;
      try {
        console.log("[x402 Flow] Authorizing spend against task budget (Circuit Breaker)");

        const guard = await authorizeX402Spend({
          taskId: params.taskId,
          requestingAgentId: params.agentId,
          recipientServiceId: "premium-market-research",
          tokenCost: X402_TOKEN_COST,
          purpose: "market_research",
          idempotencyKey,
        });

        if (guard.decision === "BLOCK") {
          console.log(`[x402 Flow] Circuit Breaker BLOCKED: ${guard.reason}`);
          return {
            output: `🚨 CIRCUIT BREAKER TRIGGERED\n\nRequested: $${X402_PRICE_USD} USDC (${X402_TOKEN_COST} token)\nStatus: BLOCKED\nReason: ${guard.reason}\nBlockchain Transaction: NONE`,
            actualLatencyMs: Date.now() - start,
            source: "circuit_breaker",
          };
        }
        intentId = guard.intentId;

        console.log("[x402 Flow] Authorized. Performing real x402 payment via official SDK...");
        const payFetch = getX402PayingFetch();
        const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
        const url = `${baseUrl}/api/x402/premium-market-research?query=${encodeURIComponent(params.taskPrompt)}&depth=premium`;

        const response = await payFetch(url, { method: "GET" });
        if (!response.ok) {
          throw new Error(`x402 request failed (HTTP ${response.status}): ${await describeX402Failure(response)}`);
        }

        const settlement = getX402SettleResponse(response);
        const txId = settlement?.transaction;
        if (!txId) {
          throw new Error("x402 response missing a PAYMENT-RESPONSE header — cannot confirm real payment");
        }

        console.log(`[x402 Flow] Settled on-chain: ${txId} (${settlement?.network ?? X402_ALGORAND_NETWORK})`);
        await finalizeX402Settlement({
          intentId,
          taskId: params.taskId,
          requestingAgentId: params.agentId,
          tokenCost: X402_TOKEN_COST,
          txId,
          network: settlement?.network ?? X402_ALGORAND_NETWORK,
          atomicAmount: settlement?.amount,
        });

        const resultData = await response.json();
        return {
          output: typeof resultData === "string" ? resultData : resultData.result || JSON.stringify(resultData),
          actualLatencyMs: Date.now() - start,
          source: "x402_premium_service_algorand_real",
        };
      } catch (err: any) {
        console.error("[x402 Flow Error]", err);
        if (intentId) {
          await failX402Intent(intentId, err.message || "x402 flow failed").catch(() => {});
        }
        // Fallback if anything in the real handshake fails to the regular research flow
      }
    }
  }

  // Agentverse-first dispatch: if the assigned agent was sourced from the
  // real Agentverse marketplace (lib/discovery/agentverseProvider.ts), try
  // to actually reach it via ASI:One before falling back to Gemini. Raw
  // Agentverse agents only speak an async Chat Protocol over a mailbox —
  // there is no synchronous path to them without ASI:One (or running our
  // own registered uAgent process, which this stack deliberately doesn't
  // do). When ASI:One isn't configured, fall back immediately and say so
  // honestly in the logs — never fabricate a reply from an agent we had no
  // way to actually deliver a message to.
  let resolvedAgent: { provider: string; model: string | null; endpoint: string | null; name: string } | null = null;
  if (params.agentId) {
    resolvedAgent = await prisma.agent.findUnique({
      where: { id: params.agentId },
      select: { provider: true, model: true, endpoint: true, name: true },
    });
  }

  if (resolvedAgent?.provider === "agentverse" && resolvedAgent.endpoint) {
    if (isAsiOneConfigured()) {
      try {
        const { output } = await invokeAgentviaAsiOne({
          agentAddress: resolvedAgent.endpoint,
          agentName: resolvedAgent.name,
          instruction: params.description,
          taskPrompt: params.taskPrompt,
        });
        return { output, actualLatencyMs: Date.now() - start, source: "agentverse" };
      } catch (err: any) {
        console.error(`[Agentverse] Live invocation of "${resolvedAgent.name}" failed — falling back to Gemini. Reason: ${err.message}`);
      }
    } else {
      console.log(`[Agentverse] "${resolvedAgent.name}" was selected but ASI1_API_KEY is not configured, so there's no synchronous path to reach it. Falling back to Gemini.`);
    }
  }

  if (!isGeminiConfigured()) {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }

  try {
    const feedbackBlock = params.feedback
      ? `\n\nA previous attempt at this subtask FAILED quality review for this reason: "${params.feedback}". Address that specifically in this attempt.`
      : "";

    let webBlock = "";
    let usedWebData = false;
    if (WEB_GROUNDED_CAPABILITIES.has(params.type)) {
      try {
        const webContext = await gatherWebContext(`${params.taskPrompt} ${params.description}`.slice(0, 300));
        webBlock = formatWebContextForPrompt(webContext);
        usedWebData = webContext.available;
        if (params.taskId) {
          await emitEvent(prisma, {
            taskId: params.taskId,
            actor: "scraper",
            eventType: "WEB_DATA_FETCHED",
            payload: {
              subtaskId: params.subtaskId ?? null,
              capability: params.type,
              available: webContext.available,
              sources: webContext.results.map((r) => ({ url: r.url, title: r.title })),
              reason: webContext.reason ?? null,
            },
          });
        }
      } catch (err) {
        console.error(`[WebScraper] Failed to gather live web context for "${params.type}":`, err);
        const message = err instanceof Error ? err.message : "unknown";
        webBlock = `\n\n[LIVE WEB DATA UNAVAILABLE — scraper error: ${message}. Rely on your training data and say so if precision on recent figures matters.]`;
      }
    }

    const tier = (resolvedAgent?.provider === "local" ? (resolvedAgent.model as GeminiModelTier | null) : null) ?? "economy";
    const { text } = await generateText({
      model: geminiModel(tier),
      prompt: `You are a specialized AI worker agent hired by Kraven's Manager Agent.
Your capability: ${params.type}.
Overall task: "${params.taskPrompt}"
Your specific instruction: ${params.description}${feedbackBlock}${webBlock}

Produce a concise, well-structured deliverable (markdown, a few paragraphs) for exactly this subtask. Do not solve the whole task — only your part. If live web data was provided above, ground your figures in it and cite source URLs; otherwise rely on your own knowledge and note where figures may be dated.`,
    });
    const baseSource = resolvedAgent?.provider === "agentverse" ? "gemini_fallback_from_agentverse" : "gemini";
    const source = usedWebData ? `${baseSource}_with_web_data` : baseSource;
    return { output: text, actualLatencyMs: Date.now() - start, source };
  } catch {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }
}
