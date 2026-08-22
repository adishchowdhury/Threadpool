"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { MomentumEvent } from "@/lib/hooks/useEventStream";

const SECURITY_EVENTS = new Set(["TRANSACTION_BLOCKED", "WALLET_REVOKED"]);
const SUCCESS_EVENTS = new Set(["QA_PASSED", "TRANSACTION_APPROVED", "TASK_COMPLETED"]);
const FAIL_EVENTS = new Set(["QA_FAILED", "TASK_FAILED", "TASK_CANCELLED"]);

function eventLine(e: MomentumEvent): string {
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

export function ActivityFeed({ events }: { events: MomentumEvent[] }) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle className="text-base">Live Activity</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <ScrollArea className="h-[420px] pr-2">
          <div className="space-y-1.5">
            {events.length === 0 && <p className="text-sm text-muted-foreground">Waiting for events...</p>}
            {events.map((e) => {
              const isSecurity = SECURITY_EVENTS.has(e.eventType);
              const isSuccess = SUCCESS_EVENTS.has(e.eventType);
              const isFail = FAIL_EVENTS.has(e.eventType);
              return (
                <div
                  key={e.id}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-mono leading-relaxed ${
                    isSecurity
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : isSuccess
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : isFail
                          ? "border-amber-500/30 bg-amber-500/5"
                          : "border-border/60"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      {e.actor}
                    </Badge>
                    <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  </div>
                  {eventLine(e)}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
