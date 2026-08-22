"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { TaskRecord, CentralLedgerRecord } from "@/lib/types";
import { useDraggable } from "@/lib/hooks/useDraggable";
import { ChevronLeft, ChevronRight, GripVertical, Wallet } from "lucide-react";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "success" }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-panel-muted">{label}</div>
      <div
        className={cn(
          "font-mono text-base font-semibold",
          tone === "danger" ? "text-rose-400" : tone === "success" ? "text-emerald-400" : "text-panel-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function EconomyPanel({
  task,
  ledger,
  open,
  onOpenChange,
}: {
  task: TaskRecord | null;
  ledger: CentralLedgerRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { containerRef, style, isDragging, handleProps } = useDraggable();
  const locked = task?.centralEscrow?.totalLocked ?? 0;
  const released = task?.centralEscrow?.totalReleased ?? 0;
  const refunded = task?.centralEscrow?.totalRefunded ?? 0;
  const blocked = ledger.filter((t) => t.status === "BLOCKED").length;

  if (!open) {
    return (
      <div className="pointer-events-auto absolute right-3 top-16 z-20 sm:right-4 sm:top-20">
        <Button
          variant="ghost"
          size="icon"
          className="group size-10 rounded-full border border-panel-border bg-panel text-panel-muted shadow-lg backdrop-blur-xl transition-all duration-200 ease-out hover:border-panel-border hover:bg-panel-elevated hover:text-panel-foreground hover:shadow-xl active:scale-95"
          onClick={() => onOpenChange(true)}
          aria-label="Expand economy panel"
          title="Expand economy panel"
        >
          <Wallet className="absolute size-3.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0" />
          <ChevronLeft className="absolute size-4 opacity-0 transition-all duration-150 group-hover:-translate-x-0.5 group-hover:opacity-100" />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={style}
      className={cn(
        "pointer-events-auto absolute right-3 top-16 z-20 flex max-h-[calc(100%-13rem)] w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-panel-border bg-panel text-panel-foreground shadow-xl backdrop-blur-xl sm:right-4 sm:top-20 sm:max-h-[calc(100%-5rem)] sm:w-72",
        !isDragging && "animate-in fade-in slide-in-from-right-2 duration-200 ease-out",
      )}
    >
      <div
        {...handleProps}
        className="flex select-none items-center justify-between gap-2 border-b border-panel-border px-3 py-2"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium tracking-tight">
          <GripVertical className="size-3.5 text-panel-muted/60" />
          Economy
          <Wallet className="size-3.5 text-panel-muted" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full text-panel-muted transition-colors hover:bg-panel-elevated hover:text-panel-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Collapse economy panel"
          title="Collapse economy panel"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0">
        <div className="animate-in fade-in space-y-4 p-3.5 duration-300">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Task Budget" value={task?.budget ?? "—"} />
            <Stat label="Remaining" value={task?.remainingBudget ?? "—"} />
            <Stat label="Escrow Locked" value={locked} />
            <Stat label="Released" value={released} tone="success" />
            <Stat label="Refunded" value={refunded} />
            <Stat label="Blocked Attempts" value={blocked} tone={blocked > 0 ? "danger" : undefined} />
          </div>
          <Separator className="bg-panel-border" />
          <div>
            <div className="mb-2 text-[11px] text-panel-muted">Recent Transactions</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {ledger.length === 0 && <p className="text-xs text-panel-muted">No transactions yet.</p>}
              {ledger.slice(0, 20).map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center justify-between rounded-sm px-2 py-1 font-mono text-[11px]",
                    t.status === "BLOCKED" ? "bg-destructive/15 text-rose-400" : "bg-panel-elevated text-panel-foreground",
                  )}
                >
                  <span>{t.type}</span>
                  <span>{t.amount}t</span>
                  <span>{t.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
