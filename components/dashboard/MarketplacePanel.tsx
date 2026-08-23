"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AgentRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

// Mirrors lib/manager/rank.ts's deterministic weighted formula, so the score
// shown here means the same thing as the one the real Manager computes when
// actually routing a subtask. It's an ESTIMATE when a capability is
// selected: latency/cost efficiency are normalized against the currently
// filtered pool (same as the real algorithm would for a same-capability
// subtask), but historicalSimilarity falls back to the same neutral-low 30
// the backend uses for an agent with no recorded history for a task type,
// since that requires a specific taskType we don't have outside a live task.
const WEIGHTS = {
  capabilityMatch: 0.3,
  quality: 0.2,
  successRate: 0.15,
  reputation: 0.1,
  latencyEfficiency: 0.1,
  costEfficiency: 0.1,
  historicalSimilarity: 0.05,
} as const;

function normalizeInverse(value: number, min: number, max: number): number {
  if (max === min) return 100;
  return 100 * (1 - (value - min) / (max - min));
}

function estimateScore(agent: AgentRecord, pool: AgentRecord[]): number {
  const latencies = pool.map((a) => a.avgLatencyMs || 1);
  const costs = pool.map((a) => a.price);
  const latencyEfficiency = normalizeInverse(agent.avgLatencyMs || 1, Math.min(...latencies), Math.max(...latencies));
  const costEfficiency = normalizeInverse(agent.price, Math.min(...costs), Math.max(...costs));
  const total =
    100 * WEIGHTS.capabilityMatch +
    agent.avgQuality * WEIGHTS.quality +
    agent.successRate * 100 * WEIGHTS.successRate +
    agent.reputation * WEIGHTS.reputation +
    latencyEfficiency * WEIGHTS.latencyEfficiency +
    costEfficiency * WEIGHTS.costEfficiency +
    30 * WEIGHTS.historicalSimilarity;
  return Math.round(total * 100) / 100;
}

function providerBadge(provider: string) {
  if (provider === "agentverse") {
    return <Badge className="shrink-0 border-accent-strong/30 bg-accent-strong/10 text-[10px] text-accent-strong">Agentverse</Badge>;
  }
  if (provider === "external") {
    return <Badge variant="outline" className="shrink-0 text-[10px]">External</Badge>;
  }
  return <Badge variant="outline" className="shrink-0 text-[10px] text-panel-muted">Local</Badge>;
}

function statusDot(status: string) {
  const tone = status === "ACTIVE" ? "bg-emerald-500" : status === "REVOKED" ? "bg-destructive" : "bg-panel-muted";
  return <span className={cn("inline-block size-1.5 rounded-full", tone)} />;
}

export function MarketplacePanel({
  agents,
  open,
  onOpenChange,
}: {
  agents: AgentRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [capability, setCapability] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "price" | "reputation">("score");

  const capabilities = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) for (const c of a.capabilities) set.add(c);
    return Array.from(set).sort();
  }, [agents]);

  const filtered = useMemo(() => {
    return capability === "all" ? agents : agents.filter((a) => a.capabilities.includes(capability));
  }, [agents, capability]);

  const rows = useMemo(() => {
    const withScore = filtered.map((a) => ({ agent: a, score: capability === "all" ? null : estimateScore(a, filtered) }));
    return withScore.sort((a, b) => {
      if (sortBy === "score") return (b.score ?? b.agent.reputation) - (a.score ?? a.agent.reputation);
      if (sortBy === "price") return a.agent.price - b.agent.price;
      return b.agent.reputation - a.agent.reputation;
    });
  }, [filtered, capability, sortBy]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Agent Marketplace</DialogTitle>
          <DialogDescription>
            Every agent currently discoverable by the Manager — {agents.filter((a) => a.provider === "agentverse").length} live from the
            real Agentverse marketplace, {agents.filter((a) => a.provider === "local").length} from the local Gemini-backed roster.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={capability} onValueChange={(v) => setCapability(v ?? "all")}>
            <SelectTrigger className="h-8 w-56 text-xs">
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
            <SelectTrigger className="h-8 w-44 text-xs">
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

          <span className="ml-auto text-[11px] text-panel-muted">{rows.length} agents</span>
        </div>

        <ScrollArea className="max-h-[55vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Quality</TableHead>
                <TableHead className="text-right">Success</TableHead>
                <TableHead className="text-right">Reputation</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">{capability === "all" ? "" : "Est. Score"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ agent, score }) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {statusDot(agent.status)}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-panel-foreground">{agent.name}</span>
                          {providerBadge(agent.provider)}
                        </div>
                        {agent.model && <div className="font-mono text-[10px] text-panel-muted">{agent.model} tier</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-55 flex-wrap gap-1">
                      {agent.capabilities.map((c) => (
                        <Badge key={c} variant="outline" className="text-[9px] font-normal text-panel-muted">
                          {c.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{agent.price}t</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Math.round(agent.avgQuality)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Math.round(agent.successRate * 100)}%</TableCell>
                  <TableCell className="text-right font-mono text-xs">{Math.round(agent.reputation)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{(agent.avgLatencyMs / 1000).toFixed(1)}s</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-panel-foreground">
                    {score != null ? score.toFixed(1) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-panel-muted">
                    No agents match this filter yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
