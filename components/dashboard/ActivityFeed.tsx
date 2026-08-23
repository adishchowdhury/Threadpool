"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KravenEvent } from "@/lib/hooks/useEventStream";
import { useDraggable } from "@/lib/hooks/useDraggable";
import { ChevronLeft, ChevronRight, GripVertical, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const SECURITY_EVENTS = new Set(["TRANSACTION_BLOCKED", "WALLET_REVOKED"]);
const SUCCESS_EVENTS = new Set(["QA_PASSED", "TRANSACTION_APPROVED", "TASK_COMPLETED"]);
const FAIL_EVENTS = new Set(["QA_FAILED", "TASK_FAILED", "TASK_CANCELLED"]);

function eventLine(e: KravenEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.eventType) {
    case "MANAGER_PLANNING":
      return `Manager is decomposing the task...`;
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
      return `${e.actor} started work${p.attempt && Number(p.attempt) > 1 ? ` (attempt ${p.attempt})` : ""}`;
    case "WORK_COMPLETED":
      return `${e.actor} completed work: "${String(p.preview ?? "").slice(0, 80)}..."`;
    case "QA_STARTED":
      return `QA reviewing output...`;
    case "QA_PASSED":
      return `QA passed — score ${p.score}/100`;
    case "QA_FAILED":
      return `QA failed: ${p.reason}`;
    case "PAYOUT_REQUESTED":
      return `${p.agentId} requested payout of ${p.amount} tokens`;
    case "TRANSACTION_APPROVED":
      return `Payment approved: ${p.amount} tokens to ${p.agentId}`;
    case "TRANSACTION_BLOCKED":
      return `CIRCUIT BREAKER BLOCKED: ${p.agentId} requested ${p.amount} tokens — ${p.reason}`;
    case "WALLET_REVOKED":
      return `Agent ${p.agentId} REVOKED for severe policy violation`;
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
    case "WORKFLOW_MEMORY_STORED":
      return p.recalled ? `Recalled a similar past workflow (${(Number(p.similarity) * 100).toFixed(0)}% match)` : `Workflow stored for future reuse`;
    case "TASK_CREATED":
      return `Task created — budget ${p.budget} tokens`;
    default:
      return e.eventType;
  }
}

export function ActivityFeed({
  events,
  open,
  onOpenChange,
}: {
  events: KravenEvent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { containerRef, style, isDragging, handleProps } = useDraggable();

  if (!open) {
    return (
      <div className="pointer-events-auto absolute left-3 top-16 z-20 sm:left-4 sm:top-20">
        <Button
          variant="ghost"
          size="icon"
          className="group size-10 rounded-full border border-panel-border bg-panel text-panel-muted shadow-lg backdrop-blur-xl transition-all duration-200 ease-out hover:border-panel-border hover:bg-panel-elevated hover:text-panel-foreground hover:shadow-xl active:scale-95"
          onClick={() => onOpenChange(true)}
          aria-label="Expand live activity"
          title="Expand live activity"
        >
          <Radio className="absolute size-3.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0" />
          <ChevronRight className="absolute size-4 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={style}
      className={cn(
        "pointer-events-auto absolute left-3 top-16 bottom-36 z-20 flex w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-panel-border bg-panel text-panel-foreground shadow-xl backdrop-blur-xl sm:left-4 sm:top-20 sm:bottom-20 sm:w-72",
        !isDragging && "animate-in fade-in slide-in-from-left-2 duration-200 ease-out",
      )}
    >
      <div
        {...handleProps}
        className="flex select-none items-center justify-between gap-2 border-b border-panel-border px-3 py-2"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium tracking-tight">
          <GripVertical className="size-3.5 text-panel-muted/60" />
          <Radio className="size-3.5 text-panel-muted" />
          Live Activity
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full text-panel-muted transition-colors hover:bg-panel-elevated hover:text-panel-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Collapse live activity"
          title="Collapse live activity"
        >
          <ChevronLeft className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="animate-in fade-in min-w-0 space-y-1.5 overflow-x-hidden p-2.5 duration-300">
          {events.length === 0 && <p className="text-xs text-panel-muted">Waiting for events...</p>}
          {events
            .slice()
            .reverse()
            .map((e) => {
              const isSecurity = SECURITY_EVENTS.has(e.eventType);
              const isSuccess = SUCCESS_EVENTS.has(e.eventType);
              const isFail = FAIL_EVENTS.has(e.eventType);
              return (
                <div
                  key={e.id}
                  className={cn(
                    "animate-in fade-in slide-in-from-top-1 min-w-0 rounded-sm border px-2.5 py-1.5 font-mono text-[11px] leading-relaxed wrap-break-word duration-300",
                    isSecurity
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : isSuccess
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100"
                        : isFail
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-100"
                          : "border-panel-border bg-panel-elevated text-panel-foreground",
                  )}
                >
                  <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      title={e.actor}
                      className="min-w-0 shrink truncate rounded-sm px-1 py-0 text-[9px]"
                    >
                      {e.actor}
                    </Badge>
                    <span className="shrink-0 text-panel-muted">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="wrap-anywhere">{eventLine(e)}</div>
                </div>
              );
            })}
        </div>
      </ScrollArea>
    </div>
  );
}
