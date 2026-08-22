"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentRecord } from "@/lib/types";

function statusColor(status: string) {
  if (status === "REVOKED") return "bg-destructive/15 text-destructive border-destructive/30";
  if (status === "INACTIVE") return "bg-muted text-muted-foreground";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
}

export function AgentRegistryPanel({
  agents,
  activeAgentIds,
  selectedAgentIds,
}: {
  agents: AgentRecord[];
  activeAgentIds: Set<string>;
  selectedAgentIds: Set<string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent Registry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {agents.map((a) => (
          <div
            key={a.id}
            className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
              selectedAgentIds.has(a.id)
                ? "border-primary bg-primary/5"
                : activeAgentIds.has(a.id)
                  ? "border-amber-400/60 bg-amber-400/5"
                  : "border-border"
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium truncate">{a.name}</span>
                <Badge variant="outline" className={statusColor(a.status)}>
                  {a.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">{a.capabilities.join(", ")}</div>
            </div>
            <div className="text-right shrink-0 pl-2">
              <div className="font-mono text-sm">{a.price}t</div>
              <div className="text-xs text-muted-foreground">rep {a.reputation.toFixed(0)}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
