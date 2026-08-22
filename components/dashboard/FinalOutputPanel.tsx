"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { TaskRecord } from "@/lib/types";
import { CheckCircle2, XCircle, Ban } from "lucide-react";

export function FinalOutputPanel({ task }: { task: TaskRecord | null }) {
  if (!task || !task.finalOutput) return null;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(task.finalOutput);
  } catch {
    return null;
  }

  if (task.status === "CANCELLED") {
    return (
      <Alert className="border-muted-foreground/30">
        <Ban className="size-4" />
        <AlertTitle>Task Cancelled</AlertTitle>
        <AlertDescription>No output was produced. Any locked escrow was refunded.</AlertDescription>
      </Alert>
    );
  }

  if (task.status === "FAILED") {
    return (
      <Alert variant="destructive">
        <XCircle className="size-4" />
        <AlertTitle>Task Failed</AlertTitle>
        <AlertDescription>{String(parsed.failure_reason ?? "Unknown failure")}</AlertDescription>
      </Alert>
    );
  }

  if (task.status === "COMPLETED") {
    const spend = parsed.spend_summary as { budget: number; spent: number; remaining: number } | undefined;
    return (
      <Card className="border-emerald-500/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Final Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {spend && (
            <div className="text-xs text-muted-foreground font-mono">
              budget {spend.budget} · spent {spend.spent} · remaining {spend.remaining}
            </div>
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm max-h-96 overflow-y-auto">
            {String(parsed.content ?? "")}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
