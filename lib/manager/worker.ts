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
import { citableSources, formatSourcesForPrompt, heuristicQueries, liveWebUnavailableText, webPass, webSearchArtifact } from "@/lib/capabilities/common";
import { generateWithReasoningGuard, upstreamBlock as renderUpstream, LANGUAGE_RULE } from "@/lib/capabilities/llm";
import { runWebResearch } from "@/lib/capabilities/webResearch";
import { runCompetitiveAnalysis } from "@/lib/capabilities/competitiveAnalysis";
import { runDataAnalysis } from "@/lib/capabilities/dataAnalysis";
import { runFinancialAnalysis } from "@/lib/capabilities/financialAnalysis";
import { runIntegrationReview } from "@/lib/capabilities/review";
import { classifyReportIntent, reportTemplate } from "@/lib/capabilities/reportIntent";
import { describeEvidenceSignals, evidenceSignals } from "@/lib/manager/confidence";
import { executeExternalTask } from "@/lib/agents/externalClient";
import type { CapabilityRunInput, CapabilityRunOutput, SubtaskArtifacts, UpstreamItem } from "@/lib/capabilities/types";
import type { ToolCallRecord } from "@/lib/tools/types";
import { clampTimeout, withTimeout } from "@/lib/runtime/deadline";

// Capabilities with a specialised runtime (tools + structured output). Every
// other capability runs through the generic prompt-based runtime below.
const SPECIALISED_RUNTIMES: Record<string, (input: CapabilityRunInput) => Promise<CapabilityRunOutput>> = {
  web_research: runWebResearch,
  competitive_analysis: runCompetitiveAnalysis,
  data_analysis: runDataAnalysis,
  financial_analysis: runFinancialAnalysis,
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

// The report is an Executive Decision Brief, not a generic polished
// write-up: its structure is chosen per task type (classifyReportIntent),
// and every section carries the epistemic rigor a user is paying for
// instead of something they could get from a plain chat with an LLM.
function reportRules(params: { taskPrompt: string; upstream: UpstreamItem[]; evidenceNote: string }): string {
  const capabilitiesUsed = params.upstream.map((u) => u.capability ?? u.type).filter(Boolean);
  const intent = classifyReportIntent(params.taskPrompt, capabilitiesUsed);
  const template = reportTemplate(intent);

  if (intent === "general") {
    return `This is the FINAL deliverable a business reader will see. Structure it as:
# <specific title>
${template.sections.join("\n")}
Use the upstream material as your evidence; carry any [S#] source tags through on every sourced statement. ${template.guidance} Aim for under 400 words.`;
  }

  return `This is the FINAL deliverable: an Executive Decision Brief. Structure it exactly as:
# <specific report title>
${template.sections.join("\n")}
Use the upstream material as your evidence - combine it, resolve overlaps, drop raw notes and process commentary, and carry any [S#] source tags through on every sourced statement. Keep figures computed by upstream analysis steps exactly as computed; never re-derive or round them differently.

${template.guidance}

Rules that make this a decision brief, not a generic report - this is what a user pays Kraven for instead of asking a chatbot the same question, so a section that is padded with generic text instead of task-specific substance defeats the point:
- Bottom Line: open with ONE sentence naming the recommendation, then these labeled lines (skip only what genuinely doesn't apply):
  - **Recommended Action:** the specific action, not "consider X".
  - **Conditions:** what must be true for this to hold (a price, a threshold, an assumption).
  - **Biggest Risk:** the single most important downside.
  - **Biggest Upside:** the single most important upside.
  - **Key Unknown:** the missing fact that would most change this if learned.
  - **Next Step:** what the user should check, request, test, negotiate, or do next - concrete, not "do more research".
  State a decision threshold wherever the evidence supports one ("attractive below $X", "proceed only if Y exceeds Z%") instead of "it depends." If no threshold can be computed from the evidence, say why, don't invent one.
- Decision Scorecard (when comparing options/segments): a markdown table of factors with a numeric score, a confidence label (High/Medium/Low), and a one-line "why" per factor, then a weighted total. State the weights you used. Do not invent scores - base each one on the evidence gathered upstream and say so in "why". If something here is a business-quality judgment (is it a good company/product) versus a price/attractiveness judgment (is it a good deal at this price), keep those visibly separate - a strong business can be a bad investment at the wrong price.
- Key Findings: 3-7 bullets, each a specific claim, not a restatement of the task.
- Evidence: for the 3-6 most important claims in this report, show what backs them - a [S#] citation, "Kraven calculation" (if computed upstream), or "estimate" with its basis. Do not list a generic bibliography here - tie each entry to a specific claim above.
- Any quantitative claim (market size, growth rate, margin, ratio, score) must be traceable: either it carries a [S#] tag, or it is explicitly labeled an estimate/assumption with what it's based on (reuse the assumption ledger from upstream financial analysis if one exists - do not re-estimate figures that step already derived). If sources disagreed upstream and that step reported a range or a contradiction, keep that disagreement visible here instead of collapsing it into one invented precise number.
- Scenarios (only when the evidence supports quantifying more than one path - otherwise omit the section rather than padding it): Base / Bull / Bear cases, each with the 1-2 assumptions driving it and the resulting figure or outcome. Label every assumption; never let a scenario read as a fact.
- Alternatives: name the realistic alternative(s) to the recommended action (a competing option, doing nothing, waiting, a cheaper/simpler approach) - a recommendation evaluated in isolation isn't a decision brief. Say concretely why the recommended path beats each alternative, not just that it exists.
- Risks: for each of the 2-4 risks that actually matter to this decision (not a generic list), give likelihood (qualitative is fine), impact, the evidence behind it, and - where it changes the action - a mitigation or an early-warning sign to watch for. Where relevant, note the second-order effect (if this risk materializes, what does it trigger next, and is that actually worse or does it open a new opportunity).
- Why This Could Be Wrong: a genuine red-team pass on the Bottom Line, not a hedge - the strongest evidence against the recommendation, the most fragile assumption it rests on, and what a sharp skeptic would say. If nothing credible contradicts the recommendation, say that plainly instead of manufacturing a weak objection.
- What Could Change This Recommendation: 3-5 concrete, checkable triggers (a metric crossing a threshold, a specific event) - not vague hedging.
- Confidence: state an overall confidence (High/Medium/Low) and justify it using this task's actual evidence base: ${params.evidenceNote} Do not claim high confidence when sources were thin or disagreed.
- Methodology: 1-3 sentences on how the workforce reached this (what was researched/computed/verified) - not marketing copy about Kraven.
- If two upstream steps reached different conclusions (e.g. the market researcher and a risk-focused step disagreed on which option is best), say so explicitly and explain how you weighed it, rather than silently picking one.
Aim for under 1100 words - evidence density over length; cut a section entirely rather than filling it with generic filler when the evidence doesn't support it.`;
}

function buildWorkerPrompt(params: {
  type: string;
  description: string;
  taskPrompt: string;
  feedbackBlock: string;
  webBlock: string;
  paidDataBlock: string;
  // Whether any [S#]-tagged sources are available to cite.
  hasSources: boolean;
  evidenceNote: string;
  upstream?: UpstreamItem[];
}): string {
  const upstream = params.upstream ?? [];
  const upstreamBlock = renderUpstream(upstream);
  const base = `${OUTPUT_RULES}\n${params.hasSources ? CITE_RULE : NO_SOURCES_RULE}`;
  const rules = REPORT_CAPABILITY_SET.has(params.type) ? `${base}\n\n${reportRules({ taskPrompt: params.taskPrompt, upstream, evidenceNote: params.evidenceNote })}` : base;
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

// Dispatches a subtask to a third-party agent over HTTP instead of Sarvam.
// Deliberately skips every Kraven-internal mechanism (specialised runtimes,
// tool calls, x402) - a provider's agent is opaque to Kraven; all Kraven
// controls is the contract at the HTTP boundary. On any failure this never
// throws - it returns the same shape a crashed internal worker produces
// (worker.ts's own catch block below), so the orchestrator's existing
// retry/reassignment logic needs no external-specific branch.
async function executeExternalAgentSubtask(
  agent: { id: string; endpoint: string | null; externalAuthSecretEncrypted: string | null },
  params: { type: string; description: string; taskPrompt: string; feedback?: string; taskId?: string; subtaskId?: string },
): Promise<SubtaskExecution> {
  const start = Date.now();
  const prompt = params.feedback
    ? `${params.description}\n\n(Previous attempt was rejected: ${params.feedback}. Address this specifically.)`
    : params.description || params.taskPrompt;

  const result = await executeExternalTask(agent, {
    taskId: params.taskId ?? "calibration",
    subtaskId: params.subtaskId ?? "calibration",
    capability: params.type,
    prompt,
    constraints: { budget: 0 },
  });

  const actualLatencyMs = Date.now() - start;
  if (!result.ok) {
    return {
      output: `[EXTERNAL AGENT ${result.reason.toUpperCase()}] ${result.message}`,
      actualLatencyMs,
      source: "external_error",
    };
  }
  return { output: result.output, actualLatencyMs, source: "external", artifacts: result.metadata ? { mode: "freeform" } : undefined };
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

  // External agents are opaque third-party HTTP services: every
  // Kraven-internal mechanism below (specialised runtimes, tool calls, x402)
  // is Sarvam-specific and must be skipped entirely for them.
  if (params.agentId) {
    const agentRow = await db.agent.findUnique({
      where: { id: params.agentId },
      select: { isExternal: true, endpoint: true, externalAuthSecretEncrypted: true },
    });
    if (agentRow?.isExternal) {
      return executeExternalAgentSubtask(
        { id: params.agentId, endpoint: agentRow.endpoint, externalAuthSecretEncrypted: agentRow.externalAuthSecretEncrypted },
        params,
      );
    }
  }

  const runtime = SPECIALISED_RUNTIMES[params.type];
  if (runtime) {
    const agent = params.agentId
      ? await db.agent.findUnique({ where: { id: params.agentId }, select: { model: true, systemPrompt: true } })
      : null;
    try {
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
    } catch (err) {
      // Runtimes fall back internally on ordinary model errors; what reaches
      // here is the attempt running out of its time budget (or a provider
      // failure in a fallback call). That's a provider-side failure, not the
      // agent's work - same treatment as the generic path below.
      console.error(`[Worker] ${params.type} runtime failed: ${err instanceof Error ? err.message : String(err)}`);
      return { output: fallbackOutput(params), actualLatencyMs: Date.now() - start, source: "local_fallback" };
    }
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

        // The purchase is an optional input to the agent's work, so it gets a
        // modest bound: a slow facilitator must not stall the step.
        const response = await withTimeout(payFetch(url, { method: "GET" }), clampTimeout(25_000), "x402 premium data purchase");
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
      webSearch = webSearchArtifact(web);
      ownSources = web.sources;
      sources = web.sources;
      if (!web.available) {
        // Live research failed: report it and stop - never answer a web-grounded
        // step from the model's training knowledge.
        return {
          output: liveWebUnavailableText(params.description.slice(0, 80), web),
          actualLatencyMs: Date.now() - start,
          source: "tool_unavailable",
          artifacts: { sources: [], webSearch, toolCalls: calls, mode: "fallback" },
        };
      }
    }
    if (sources.length > 0) {
      webBlock = `\n\nRetrieved sources (fetched live by Kraven; cite by id where you rely on them):\n${formatSourcesForPrompt(sources, 1200)}`;
    }

    const tier = (resolvedAgent?.model as SarvamModelTier | null) ?? "economy";
    const { text, usage } = await generateWithReasoningGuard({
      tier,
      system: resolvedAgent?.systemPrompt,
      prompt: buildWorkerPrompt({ ...params, webBlock, paidDataBlock, feedbackBlock, hasSources: sources.length > 0, evidenceNote: describeEvidenceSignals(evidenceSignals(sources)) }),
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
