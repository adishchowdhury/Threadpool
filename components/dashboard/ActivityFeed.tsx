"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { KravenEvent } from "@/lib/hooks/useEventStream";
import { cn } from "@/lib/utils";

const SECURITY_EVENTS = new Set(["TRANSACTION_BLOCKED", "WALLET_REVOKED"]);
const SUCCESS_EVENTS = new Set(["QA_PASSED", "TRANSACTION_APPROVED", "TASK_COMPLETED"]);
const FAIL_EVENTS = new Set(["QA_FAILED", "TASK_FAILED", "TASK_CANCELLED", "REWORK_REQUESTED"]);

// Worker output previews are raw markdown ("## Heading ### Sub **bold**"), which
// reads as noise in a one-line log entry.
function plainPreview(text: string, max = 90): string {
  const plain = text.replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

function humanize(raw: string): string {
  const spaced = raw.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function eventLine(e: KravenEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.eventType) {
    case "MANAGER_PLANNING":
      return `Manager is decomposing the task…`;
    case "SUBTASK_CREATED":
      return `Subtask created: ${p.type} (needs ${p.requiredCapability})`;
    case "AGENTS_DISCOVERED":
      return `Discovered ${p.count} candidate agent(s)`;
    case "AGENTS_FILTERED":
      return `Filtered to ${p.count} eligible agent(s)`;
    case "BID_RECEIVED":
      return `${p.agentId} bid ${p.amount} tokens`;
    case "AGENT_SELECTED":
      return String(p.explanation ?? `Selected ${p.agentId}`);
    case "ESCROW_LOCKED":
      return `Escrow locked: ${p.amount} tokens for ${p.agentId}`;
    case "WORK_STARTED":
      if (p.revision) return `${e.actor} revising its work (rework round ${p.revision})`;
      return `${e.actor} started work${p.attempt && Number(p.attempt) > 1 ? ` (attempt ${p.attempt})` : ""}`;
    case "PLAN_ADJUSTED": {
      const dropped = Array.isArray(p.dropped) ? (p.dropped as Array<{ type: string; reason: string }>) : [];
      return dropped.length
        ? `Workflow fitted to budget: dropped ${dropped.map((d) => d.type).join(", ")}`
        : `Workflow normalized (${Array.isArray(p.normalization) ? p.normalization.length : 0} adjustment(s))`;
    }
    case "TOOL_CALLED":
      return `${e.actor} used ${p.tool}: ${p.ok ? p.summary : `failed — ${p.error}`}`;
    case "INTEGRATION_REVIEW_COMPLETED": {
      const issues = Array.isArray(p.issues) ? p.issues.length : 0;
      return p.approved ? `Final review approved the deliverable (${p.score}/100)` : `Final review requested changes: ${issues} issue(s)`;
    }
    case "REWORK_REQUESTED": {
      const targets = Array.isArray(p.targets) ? (p.targets as Array<{ type: string }>) : [];
      return `Sending work back (round ${p.round}) to: ${targets.map((t) => t.type).join(", ")}`;
    }
    case "REWORK_COMPLETED":
      return p.resolved ? `Rework resolved all blocking issues` : `Rework limit reached — unresolved issues are disclosed in the report`;
    case "WORK_COMPLETED":
      return `${e.actor} completed work: “${plainPreview(String(p.preview ?? ""))}”`;
    case "WEB_DATA_FETCHED": {
      const sources = Array.isArray(p.sources) ? p.sources.length : 0;
      return p.available ? `Fetched ${sources} live source${sources === 1 ? "" : "s"}` : "No live web data available";
    }
    case "QA_STARTED":
      return `QA reviewing output…`;
    case "QA_PASSED":
      return `QA passed — score ${p.score}/100`;
    case "QA_FAILED":
      return `QA failed: ${p.reason}`;
    case "PAYOUT_REQUESTED":
      return `${p.agentId} requested payout of ${p.amount} tokens`;
    case "TRANSACTION_APPROVED":
      return `Payment approved: ${p.amount} tokens to ${p.agentId}`;
    case "TRANSACTION_BLOCKED":
      return `Circuit breaker blocked ${p.agentId}: requested ${p.amount} tokens — ${p.reason}`;
    case "WALLET_REVOKED":
      return `Agent ${p.agentId} revoked for severe policy violation`;
    case "ESCROW_REFUNDED":
      return `Escrow refunded: ${p.amount} tokens (${p.reason})`;
    case "TASK_CANCELLED":
      return `Task cancelled`;
    case "TASK_FAILED":
      return `Task failed: ${p.reason}`;
    case "TASK_COMPLETED":
      return `Task completed`;
    case "REPUTATION_UPDATED":
      return `Reputation updated for ${p.agentId}: ${p.reputation}`;
    case "CONFIDENCE_COMPUTED":
      return `Overall confidence: ${String(p.label).toUpperCase()} (${p.score}/100) — ${p.reason}`;
    case "WORKFLOW_MEMORY_STORED":
      return p.recalled ? `Recalled a similar past workflow (${(Number(p.similarity) * 100).toFixed(0)}% match)` : `Workflow stored for future reuse`;
    case "TASK_CREATED":
      return `Task created — budget ${p.budget} tokens`;
    default:
      return humanize(e.eventType);
  }
}

type Tone = "security" | "success" | "fail" | "default";

const TONES: Record<Tone, { row: string; dot: string; text: string }> = {
  security: { row: "bg-destructive/5", dot: "bg-destructive", text: "text-destructive" },
  fail: { row: "bg-amber-500/5", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  success: { row: "", dot: "bg-emerald-500", text: "text-foreground" },
  default: { row: "", dot: "bg-muted-foreground/40", text: "text-foreground" },
};

function toneOf(eventType: string): Tone {
  if (SECURITY_EVENTS.has(eventType)) return "security";
  if (FAIL_EVENTS.has(eventType)) return "fail";
  if (SUCCESS_EVENTS.has(eventType)) return "success";
  return "default";
}

// Raw, chronological log of everything the backend emitted for this task.
// Newest first. Every line is a persisted event - nothing here is synthesized.
export function ActivityList({ events }: { events: KravenEvent[] }) {
  if (events.length === 0) {
    return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">No activity yet. Events appear here as the workforce works.</p>;
  }
  return (
    <ScrollArea className="h-full">
      <ul className="min-w-0 overflow-x-hidden py-1">
        {events
          .slice()
          .reverse()
          .map((e) => {
            const tone = TONES[toneOf(e.eventType)];
            return (
              <li
                key={e.id}
                className={cn(
                  "flex min-w-0 animate-in fade-in slide-in-from-top-1 gap-3 border-b border-border/60 px-5 py-3 duration-300 ease-out last:border-b-0",
                  tone.row,
                )}
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full transition-colors duration-300", tone.dot)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span title={e.actor} className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {e.actor.replace(/_/g, " ")}
                    </span>
                    <time dateTime={e.createdAt} className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">
                      {new Date(e.createdAt).toLocaleTimeString()}
                    </time>
                  </div>
                  <p className={cn("mt-0.5 text-[13px] leading-snug wrap-anywhere", tone.text)}>{eventLine(e)}</p>
                </div>
              </li>
            );
          })}
      </ul>
    </ScrollArea>
  );
}
