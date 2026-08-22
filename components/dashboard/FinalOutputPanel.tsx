"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/dashboard/MarkdownView";
import type { TaskRecord } from "@/lib/types";
import { CheckCircle2, XCircle, Ban, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export function FinalOutputPanel({
  task,
  open,
  onOpenChange,
}: {
  task: TaskRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Reset the transient "Copied" state if the dialog is reopened for a
  // different report, so a stale checkmark never lingers across tasks.
  useEffect(() => {
    setCopied(false);
  }, [task?.id, open]);

  if (!task || !task.finalOutput) return null;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(task.finalOutput);
  } catch {
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(parsed.content ?? ""));
      setCopied(true);
      toast.success("Report copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — clipboard access was denied.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        {task.status === "CANCELLED" && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-muted-foreground">
              <Ban className="size-4" /> Task Cancelled
            </DialogTitle>
            <DialogDescription>No output was produced. Any locked escrow was refunded.</DialogDescription>
          </DialogHeader>
        )}

        {task.status === "FAILED" && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="size-4" /> Task Failed
            </DialogTitle>
            <DialogDescription>{String(parsed.failure_reason ?? "Unknown failure")}</DialogDescription>
          </DialogHeader>
        )}

        {task.status === "COMPLETED" && (
          <>
            <DialogHeader className="flex-row items-start justify-between gap-3 pr-8 space-y-0">
              <div className="space-y-1.5">
                <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> Final Report
                </DialogTitle>
                {parsed.spend_summary != null && (
                  <DialogDescription className="font-mono text-xs">
                    {(() => {
                      const spend = parsed.spend_summary as { budget: number; spent: number; remaining: number };
                      return `budget ${spend.budget} · spent ${spend.spent} · remaining ${spend.remaining}`;
                    })()}
                  </DialogDescription>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5">
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <MarkdownView content={String(parsed.content ?? "")} className="pr-3 text-sm text-panel-foreground" />
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
