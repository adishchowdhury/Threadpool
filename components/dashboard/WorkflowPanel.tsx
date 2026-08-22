"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SubtaskRecord } from "@/lib/types";
import { ArrowRight } from "lucide-react";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING: "bg-muted text-muted-foreground",
    BIDDING: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    ASSIGNED: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    EXECUTING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    AWAITING_QA: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    DONE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    FAILED: "bg-destructive/15 text-destructive",
  };
  return map[status] ?? "bg-muted";
}

export function WorkflowPanel({ subtasks }: { subtasks: SubtaskRecord[] }) {
  if (subtasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No workflow constructed yet — submit a task to begin.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workflow Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-stretch gap-2">
          {subtasks
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .map((s, i, arr) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className={`rounded-lg border p-3 w-52 space-y-1.5 ${statusBadge(s.status)} bg-opacity-40 border-current/20`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{s.type}</span>
                    <Badge variant="outline" className={statusBadge(s.status)}>
                      {s.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{s.requiredCapability}</div>
                  {s.assignedAgent && (
                    <div className="text-xs">
                      <span className="font-medium">{s.assignedAgent.name}</span>
                      {s.qaScore != null && <span className="text-muted-foreground"> · QA {s.qaScore}/100</span>}
                    </div>
                  )}
                  {s.attemptCount > 1 && <div className="text-xs text-amber-600 dark:text-amber-400">retry {s.attemptCount}</div>}
                </div>
                {i < arr.length - 1 && <ArrowRight className="size-4 text-muted-foreground shrink-0" />}
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
