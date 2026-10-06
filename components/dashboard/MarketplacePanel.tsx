"use client";

import { useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AgentRecord } from "@/lib/types";
import { scoreCandidates } from "@/lib/manager/scoring";
import { tokenRateLabel } from "@/lib/economy/tokenValue";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", REVOKED: "Revoked", INACTIVE: "Inactive" };

function StatusDot({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/15"
      : status === "REVOKED"
        ? "bg-destructive shadow-[0_0_0_3px] shadow-destructive/15"
        : "bg-panel-muted";
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status] ?? status}
      title={STATUS_LABEL[status] ?? status}
      className={cn("mt-1.5 inline-block size-1.5 shrink-0 self-start rounded-full transition-colors duration-300", tone)}
    />
  );
}

// Unmeasured values read as quietly absent rather than as data.
function Dash() {
  return (
    <span className="text-panel-muted/60" aria-label="Not yet measured">
      &mdash;
    </span>
  );
}

const headCell =
  "sticky top-0 z-10 h-11 bg-popover px-3 text-[11px] font-medium tracking-wider whitespace-nowrap text-panel-muted uppercase shadow-[inset_0_-1px_0_var(--panel-border)]";
const metricCell = "px-3 py-4 text-right font-mono text-[13px] tabular-nums text-panel-foreground";

export function MarketplacePanel({
  agents: allAgents,
  open,
  onOpenChange,
}: {
  agents: AgentRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [capability, setCapability] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "price" | "reputation">("score");

  // Retired listings (no longer in the roster) can't be hired, so don't show them.
  const agents = useMemo(() => allAgents.filter((a) => a.status !== "INACTIVE"), [allAgents]);

  const capabilities = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) for (const c of a.capabilities) set.add(c);
    return Array.from(set).sort();
  }, [agents]);

  const filtered = useMemo(() => {
    return capability === "all" ? agents : agents.filter((a) => a.capabilities.includes(capability));
  }, [agents, capability]);

  const rows = useMemo(() => {
    // Same pure scoring the Manager uses (lib/manager/scoring.ts). With no
    // live task there is no task-type history, so history falls back to the
    // same default the router uses for an agent with none.
    const scores =
      capability === "all"
        ? null
        : new Map(
            scoreCandidates({ candidates: filtered, prices: new Map(), requiredCapability: capability, history: new Map() }).map((s) => [s.agent.id, s.totalScore]),
          );
    const withScore = filtered.map((a) => ({ agent: a, score: scores?.get(a.id) ?? null }));
    return withScore.sort((a, b) => {
      if (sortBy === "score") return (b.score ?? b.agent.reputation) - (a.score ?? a.agent.reputation);
      if (sortBy === "price") return a.agent.price - b.agent.price;
      return b.agent.reputation - a.agent.reputation;
    });
  }, [filtered, capability, sortBy]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="gap-1.5 px-8 pt-7 pb-5 pr-16">
          <DialogTitle className="text-lg leading-tight font-semibold tracking-tight text-panel-foreground">Agent Registry</DialogTitle>
          <DialogDescription className="max-w-2xl text-[13px] leading-relaxed text-panel-muted">
            The worker pool the Manager hires from for each step of a workflow. Workers are chosen per step by capability, measured quality,
            reliability, latency and price &mdash; quality, success and latency are measured from benchmark and job runs.
          </DialogDescription>
        </DialogHeader>

        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-5 right-6 text-panel-muted hover:text-panel-foreground" />}
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>

        <div className="flex flex-wrap items-center gap-3 px-8 pb-5">
          <Select value={capability} onValueChange={(v) => setCapability(v ?? "all")}>
            <SelectTrigger className="h-9 w-56 text-[13px]">
              <SelectValue placeholder="Filter by capability">
                {(value: string) => (value === "all" ? "All capabilities" : value.replace(/_/g, " "))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All capabilities</SelectItem>
              {capabilities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(v) => setSortBy((v ?? "score") as typeof sortBy)}>
            <SelectTrigger className="h-9 w-48 text-[13px]">
              <SelectValue placeholder="Sort by">
                {(value: string) => `Sort: ${value === "score" ? "routing score" : value}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Sort: routing score</SelectItem>
              <SelectItem value="price">Sort: price</SelectItem>
              <SelectItem value="reputation">Sort: reputation</SelectItem>
            </SelectContent>
          </Select>

          <span className="ml-auto text-xs tabular-nums text-panel-muted">
            {rows.length} {rows.length === 1 ? "agent" : "agents"}
          </span>
        </div>

        <ScrollArea className="max-h-[55vh] border-t border-panel-border">
          {/* Plain <table>: the shared Table wrapper adds its own overflow container, which would stop the header sticking. */}
          <table data-slot="table" className="w-full min-w-215 caption-bottom text-sm">
            <TableHeader className="[&_tr]:border-b-0">
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(headCell, "pl-8")}>Agent</TableHead>
                <TableHead className={headCell}>Capabilities</TableHead>
                <TableHead className={cn(headCell, "text-right")} title={tokenRateLabel()}>
                  Price
                </TableHead>
                <TableHead className={cn(headCell, "text-right")}>Quality</TableHead>
                <TableHead className={cn(headCell, "text-right")}>Success</TableHead>
                <TableHead className={cn(headCell, "text-right")}>Reputation</TableHead>
                <TableHead className={cn(headCell, "text-right")}>Latency</TableHead>
                <TableHead className={cn(headCell, "text-right")}>Samples</TableHead>
                <TableHead className={cn(headCell, "pr-8 text-right")}>{capability === "all" ? "" : "Est. Score"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ agent, score }) => {
                const measured = agent.sampleCount > 0;
                return (
                  <TableRow
                    key={agent.id}
                    className="animate-in fade-in border-panel-border transition-colors duration-200 hover:bg-panel-elevated"
                  >
                    <TableCell className="py-4 pr-3 pl-8">
                      <div className="flex items-start gap-3">
                        <StatusDot status={agent.status} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm leading-tight font-semibold text-panel-foreground">{agent.name}</span>
                            {agent.model && (
                              <span
                                title="Model tier"
                                className="rounded bg-panel-elevated px-1.5 py-px font-mono text-[10px] tracking-wide text-panel-muted uppercase"
                              >
                                {agent.model}
                              </span>
                            )}
                          </div>
                          {agent.isExternal ? (
                            <div className="mt-1 max-w-64 truncate text-xs text-panel-muted">
                              <Badge variant="outline" className="h-4.5 rounded-sm border-panel-border bg-transparent px-1 text-[10px] font-normal">
                                External
                              </Badge>{" "}
                              · {agent.providerName ?? "Unknown provider"}
                              {agent.lifecycleStatus && agent.lifecycleStatus !== "ACTIVE" && ` · ${agent.lifecycleStatus.replace(/_/g, " ").toLowerCase()}`}
                            </div>
                          ) : (
                            agent.role && <div className="mt-1 max-w-64 truncate text-xs text-panel-muted">{agent.role}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-4">
                      <div className="flex max-w-56 flex-wrap gap-1.5">
                        {agent.capabilities.map((c) => (
                          <Badge
                            key={c}
                            variant="outline"
                            className={cn(
                              "h-5 rounded-md border-panel-border bg-transparent px-1.5 text-[11px] font-normal text-panel-muted",
                              c === capability && "border-panel-muted/50 text-panel-foreground",
                            )}
                          >
                            {c.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className={metricCell}>{agent.price > 0 ? `${agent.price}t` : <Dash />}</TableCell>
                    <TableCell className={metricCell}>{measured ? Math.round(agent.avgQuality) : <Dash />}</TableCell>
                    <TableCell className={metricCell}>{measured ? `${Math.round(agent.successRate * 100)}%` : <Dash />}</TableCell>
                    <TableCell className={metricCell}>{measured ? Math.round(agent.reputation) : <Dash />}</TableCell>
                    <TableCell className={metricCell}>{measured ? `${(agent.avgLatencyMs / 1000).toFixed(1)}s` : <Dash />}</TableCell>
                    <TableCell className={cn(metricCell, "text-panel-muted")}>{agent.sampleCount}</TableCell>
                    <TableCell className="py-4 pr-8 pl-3 text-right">
                      {score != null && (
                        <span className="inline-flex min-w-12 justify-center rounded-md bg-panel-elevated px-2 py-1 font-mono text-[13px] font-semibold tabular-nums text-panel-foreground">
                          {score.toFixed(1)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow className="animate-in fade-in duration-300 hover:bg-transparent">
                  <TableCell colSpan={9} className="px-8 py-12 text-center text-sm text-panel-muted">
                    No agents match this filter yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </table>
        </ScrollArea>

        <p className="border-t border-panel-border px-8 py-3.5 text-xs text-panel-muted">
          Prices are in tokens ({tokenRateLabel()}). Agents not yet measured show <span aria-hidden>&mdash;</span> until they complete a run.
        </p>
      </DialogContent>
    </Dialog>
  );
}
