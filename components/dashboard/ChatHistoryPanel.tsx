"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { TaskRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_TONE: Record<string, string> = {
  COMPLETED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  CANCELLED: "border-panel-border bg-panel-elevated text-panel-muted",
};

function statusBadgeClass(status: string) {
  return STATUS_TONE[status] ?? "border-accent-strong/30 bg-accent-strong/10 text-accent-strong";
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChatHistoryPanel({
  open,
  onOpenChange,
  activeTaskId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTaskId: string | null;
  onSelect: (taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setTasks(data.tasks ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't reach the server to load chat history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleSelect(id: string) {
    onSelect(id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Chat History</DialogTitle>
          <DialogDescription>Past tasks you've run — select one to reopen its workflow, ledger, and report.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-1.5 pr-3">
            {loading && <p className="py-6 text-center text-sm text-panel-muted">Loading...</p>}
            {!loading && tasks.length === 0 && (
              <p className="py-6 text-center text-sm text-panel-muted">No past tasks yet — run one from the chat bar.</p>
            )}
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleSelect(task.id)}
                className={cn(
                  "w-full rounded-lg border border-panel-border bg-panel-elevated/60 px-3 py-2.5 text-left transition-colors hover:bg-panel-elevated",
                  activeTaskId === task.id && "border-accent-strong/50 bg-accent-strong/10",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-medium text-panel-foreground">{task.prompt}</span>
                  <Badge variant="outline" className={cn("shrink-0 font-mono text-[10px]", statusBadgeClass(task.status))}>
                    {task.status}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-panel-muted">
                  <span>{formatWhen(task.createdAt)}</span>
                  <span className="text-panel-border">·</span>
                  <span>budget {task.budget}t</span>
                  <span className="text-panel-border">·</span>
                  <span>quality {task.qualityThreshold}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
