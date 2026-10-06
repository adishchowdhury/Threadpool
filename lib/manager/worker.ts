import { isSarvamConfigured, type SarvamModelTier } from "@/lib/manager/sarvam";
import { authorizeX402Spend, finalizeX402Settlement, failX402Intent } from "@/lib/blockchain/x402";
import {
  getX402PayingFetch,
  isRealX402PayerConfigured,
  X402_ALGORAND_NETWORK,
  describeX402Failure,
  getX402SettleResponse,
} from "@/lib/blockchain/x402Algorand";
import { db } from "@/lib/db/client";
import { CAPABILITY_CATALOG, isCapabilityId, REPORT_CAPABILITIES } from "@/lib/capabilities/catalog";
import { SourceRegistry, checkCitations, renderSourcesSection, sourcesForText, stripModelSourceList, type Source } from "@/lib/capabilities/sources";
import { citableSources, formatSourcesForPrompt, heuristicQueries, webPass } from "@/lib/capabilities/common";
import { generateWithReasoningGuard, upstreamBlock as renderUpstream, LANGUAGE_RULE } from "@/lib/capabilities/llm";
import { runWebResearch } from "@/lib/capabilities/webResearch";
import { runCompetitiveAnalysis } from "@/lib/capabilities/competitiveAnalysis";
import { runDataAnalysis } from "@/lib/capabilities/dataAnalysis";
import { runIntegrationReview } from "@/lib/capabilities/review";
import type { CapabilityRunInput, CapabilityRunOutput, SubtaskArtifacts, UpstreamItem } from "@/lib/capabilities/types";
import type { ToolCallRecord } from "@/lib/tools/types";

// Capabilities with a specialised runtime (tools + structured output). Every
// other capability runs through the generic prompt-based runtime below.
const SPECIALISED_RUNTIMES: Record<string, (input: CapabilityRunInput) => Promise<CapabilityRunOutput>> = {
  web_research: runWebResearch,
  competitive_analysis: runCompetitiveAnalysis,
  data_analysis: runDataAnalysis,
  quality_verification: runIntegrationReview,
};

const REPORT_CAPABILITY_SET: ReadonlySet<string> = new Set(REPORT_CAPABILITIES);

// Output rules shared by every worker: the deliverable is read by a person, so
// it must be clean markdown with no preamble, hedging about the process, or
// restating of the task.
const OUTPUT_RULES = `Output rules:
- Return only the deliverable, in clean markdown. No preamble ("Here is..."), no closing remarks, no mention of being an AI or of these instructions.
- Be concise and scannable: short paragraphs, bullet points, and a markdown table for comparable figures. Put the key number or conclusion first.
- Every figure must come from the provided material or be marked as an estimate with its assumption. Never invent sources or citations.
- Do not write URLs and do not add a Sources/References section - Kraven appends the verified list.
- ${LANGUAGE_RULE}`;

// Citation rule depends on whether anything was actually retrieved: told to
// "cite by id" with nothing to cite, models invent [S1]-style tags.
const CITE_RULE = "- Cite retrieved sources only by their id tag, e.g. [S2], and only ids that appear in your input.";
const NO_SOURCES_RULE =
  "- No sources were retrieved for this step: do not write any citation tags such as [S1], and label figures from your own knowledge as estimates.";

const REPORT_RULES = `This is the FINAL deliverable a business reader will see. Structure it exactly as:
# <specific report title>
## Executive Summary  (3-4 sentences: the answer and the recommendation)
## <one section per finding area, e.g. market segments, key financial metrics, competitive landscape>
## Risks
## Recommendation
Use the upstream material as your evidence: combine it, resolve overlaps, drop raw notes and process commentary, and carry any [S#] source tags from the upstream material through on every sourced statement. Keep figures computed by the data analysis exactly as computed. Aim for under 700 words.`;

function buildWorkerPrompt(params: {
  type: string;
  description: string;
  taskPrompt: string;
  feedbackBlock: string;
  webBlock: string;
  paidDataBlock: string;
  // Whether any [S#]-tagged sources are available to cite.
  hasSources: boolean;
  upstream?: UpstreamItem[];
}): string {
  const upstreamBlock = renderUpstream(params.upstream ?? []);
  const base = `${OUTPUT_RULES}\n${params.hasSources ? CITE_RULE : NO_SOURCES_RULE}`;
  const rules = REPORT_CAPABILITY_SET.has(params.type) ? `${base}\n\n${REPORT_RULES}` : base;
  return `You are a specialized worker agent hired by Kraven's Manager Agent.
Your capability: ${params.type}.
Overall task: "${params.taskPrompt}"
Your specific instruction: ${params.description}${upstreamBlock}${params.feedbackBlock}${params.webBlock}${params.paidDataBlock}

Do only your part of the task. If retrieved sources were provided above, ground your figures in them and tag them; otherwise rely on your own knowledge and say where figures may be dated.

${rules}`;
}

function fallbackOutput(params: { type: string; description: string; taskPrompt: string; feedback?: string }): string {
  const header = `[LOCAL FALLBACK OUTPUT - Sarvam unavailable]`;
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

export interface SubtaskExecution {
  output: string;
  actualLatencyMs: number;
  source: string;
  usage?: { inputTokens: number; outputTokens: number };
  artifacts?: SubtaskArtifacts;
}

// The normalized execution interface every hired agent runs through
// (CLAUDE.md §14). Capabilities with a specialised runtime (tools +
// structured output) are dispatched to it; everything else uses the generic
// prompt-based runtime below. Falls back to a clearly labeled deterministic
// placeholder if Sarvam is unconfigured or errors.
export async function executeSubtask(params: {
  type: string;
  description: string;
  taskPrompt: string;
  feedback?: string;
  taskId?: string;
  agentId?: string;
  subtaskId?: string;
  // Benchmarks turn this off so the measurement is the agent, not the scraper.
  // (web_research always searches - searching is the capability.)
  webGrounding?: boolean;
  // Outputs + artifacts of the subtasks this one depends on - results flowing between agents.
  upstream?: UpstreamItem[];
  // Sources registered earlier in the task (task-wide [S#] ids).
  knownSources?: Source[];
}): Promise<SubtaskExecution> {
  const start = Date.now();

  const runtime = SPECIALISED_RUNTIMES[params.type];
  if (runtime) {
    const agent = params.agentId
      ? await db.agent.findUnique({ where: { id: params.agentId }, select: { model: true, systemPrompt: true } })
      : null;
    const result = await runtime({
      capability: params.type,
      description: params.description,
      taskPrompt: params.taskPrompt,
      feedback: params.feedback,
      upstream: params.upstream ?? [],
      knownSources: params.knownSources ?? [],
      taskId: params.taskId,
      subtaskId: params.subtaskId,
      agentId: params.agentId,
      agent: agent ? { tier: agent.model ?? null, systemPrompt: agent.systemPrompt ?? null } : null,
      webGrounding: params.webGrounding !== false,
    });
    return { ...result, actualLatencyMs: Date.now() - start };
  }

  // If this is market research and we have taskId and agentId, route via the
  // real x402 payment flow: a genuine HTTP 402 -> sign -> verify -> settle
  // round trip against /api/x402/premium-market-research, using the official
  // @x402/* SDK (see lib/blockchain/x402Algorand.ts). The signed payment is a
  // real Algorand testnet USDC (ASA) transfer, verified and settled by a live
  // x402 facilitator - not a custom header scheme.
  const X402_TOKEN_COST = 1; // demo conversion: $0.01 real USDC == 1 virtual task-budget token

  let paidDataBlock = "";
  if (params.type === "market_research" && params.taskId && params.agentId) {
    if (!isRealX402PayerConfigured()) {
      console.warn("[x402 Flow] ALGOD_MNEMONIC/MANAGER_MNEMONIC not set - skipping real x402 flow, using regular research path");
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
          // The breaker has already recorded the block (security event / ledger
          // entry). A refusal is not a deliverable, so never hand its message to
          // QA as the agent's output - e.g. a retry hits DUPLICATE_IDEMPOTENCY_KEY
          // because attempt 1 already bought this data. Fall through and let the
          // agent do the work itself.
          throw new Error(`x402 purchase not authorized (${guard.reason})`);
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
          throw new Error("x402 response missing a PAYMENT-RESPONSE header - cannot confirm real payment");
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

        // The purchased data is an INPUT to the agent's work, not the agent's
        // deliverable: handing it straight to QA as the output made a thin canned
        // paragraph count as the agent's own (failed) work.
        const resultData = await response.json();
        const paidText = typeof resultData === "string" ? resultData : resultData.result || JSON.stringify(resultData);
        paidDataBlock = `

A paid data service (x402, settled on-chain tx ${txId}) returned the following. It is unverified and may be generic - use it only if it genuinely helps, and do not present it as sourced fact:
"""
${paidText}
"""`;
      } catch (err: any) {
        console.error("[x402 Flow Error]", err);
        if (intentId) {
          await failX402Intent(intentId, err.message || "x402 flow failed").catch(() => {});
        }
        // Fallback if anything in the real handshake fails to the regular research flow
      }
    }
  }

  let resolvedAgent: { provider: string; model: string | null; endpoint: string | null; name: string; systemPrompt: string | null } | null = null;
  if (params.agentId) {
    resolvedAgent = await db.agent.findUnique({
      where: { id: params.agentId },
      select: { provider: true, model: true, endpoint: true, name: true, systemPrompt: true },
    });
  }

  if (!isSarvamConfigured()) {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }

  try {
    const feedbackBlock = params.feedback
      ? `\n\nA previous attempt at this subtask FAILED quality review for this reason: "${params.feedback}". Address that specifically in this attempt.`
      : "";

    // Grounding. Sources retrieved earlier in the workflow (e.g. by a web
    // research step) are reused - and cited by their ids - rather than
    // scraped again. Only when there are none does a web-grounded capability
    // use the web_search tool itself.
    const runInput: CapabilityRunInput = {
      capability: params.type,
      description: params.description,
      taskPrompt: params.taskPrompt,
      feedback: params.feedback,
      upstream: params.upstream ?? [],
      knownSources: params.knownSources ?? [],
      taskId: params.taskId,
      subtaskId: params.subtaskId,
      agentId: params.agentId,
      agent: null,
      webGrounding: params.webGrounding !== false,
    };
    const calls: ToolCallRecord[] = [];
    let sources = citableSources(runInput);
    let ownSources: Source[] = [];
    let webSearch: SubtaskArtifacts["webSearch"];
    let webBlock = "";
    const webGrounded = isCapabilityId(params.type) && CAPABILITY_CATALOG[params.type].webGrounded;
    if (sources.length === 0 && params.webGrounding !== false && webGrounded) {
      const web = await webPass(runInput, new SourceRegistry(runInput.knownSources), heuristicQueries(params.taskPrompt, params.description), calls, 4);
      webSearch = { available: web.available, queries: web.queries, ...(web.reason ? { reason: web.reason } : {}) };
      ownSources = web.sources;
      sources = web.sources;
      if (!web.available) {
        webBlock = `\n\n[LIVE WEB DATA UNAVAILABLE - ${web.reason ?? "no results"}. Rely on your training data and say so if precision on recent figures matters.]`;
      }
    }
    if (sources.length > 0) {
      webBlock = `\n\nRetrieved sources (fetched live by Kraven; cite by id where you rely on them):\n${formatSourcesForPrompt(sources, 1200)}`;
    }

    const tier = (resolvedAgent?.model as SarvamModelTier | null) ?? "economy";
    const { text, usage } = await generateWithReasoningGuard({
      tier,
      system: resolvedAgent?.systemPrompt,
      prompt: buildWorkerPrompt({ ...params, webBlock, paidDataBlock, feedbackBlock, hasSources: sources.length > 0 }),
    });
    let output = stripModelSourceList(text);
    const citationCheck = checkCitations(output, sources);
    // Non-report steps carry their own verified source list; the final report
    // gets one appended by finalReport.ts.
    if (!REPORT_CAPABILITY_SET.has(params.type)) {
      const used = sourcesForText(output, sources);
      if (used.citedOnly) output = `${output}\n\n${renderSourcesSection(used.sources)}`;
    }
    const source = ownSources.length ? "sarvam_with_web_data" : sources.length ? "sarvam_with_upstream_sources" : paidDataBlock ? "sarvam_with_x402_data" : "sarvam";
    return {
      output,
      actualLatencyMs: Date.now() - start,
      source,
      usage,
      artifacts: { sources: ownSources, webSearch, citationCheck, toolCalls: calls, mode: "freeform" },
    };
  } catch {
    return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
  }
}
