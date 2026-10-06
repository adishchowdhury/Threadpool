"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { KravenEvent } from "@/lib/hooks/useEventStream";
import type { AlgorandLedgerTransactionRecord, CentralLedgerRecord, SecurityEventRecord, TaskRecord } from "@/lib/types";
import { WorkflowPanel } from "@/components/dashboard/WorkflowPanel";
import { ActivityList } from "@/components/dashboard/ActivityFeed";
import { EconomyContent } from "@/components/dashboard/EconomyPanel";
import type { BlockchainWorkflowEventRecord } from "@/components/dashboard/TrustPanel";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type Tab = "workflow" | "activity" | "economy";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "workflow", label: "Workflow" },
  { id: "activity", label: "Activity" },
  { id: "economy", label: "Budget" },
];

interface MemoryRecall {
  similarity: number;
  agentsUsed: string[];
  historicalCost: number;
  historicalLatencyMs: number;
  historicalQuality: number;
}

export function DetailsDrawer({
  task,
  events,
  ledger,
  paymentIntents,
  blockchainTransactions,
  blockchainWorkflowEvents,
  algorandTransactions,
  securityEvents,
  memoryRecall,
  onClose,
}: {
  task: TaskRecord | null;
  events: KravenEvent[];
  ledger: CentralLedgerRecord[];
  paymentIntents: any[];
  blockchainTransactions: any[];
  blockchainWorkflowEvents: BlockchainWorkflowEventRecord[];
  algorandTransactions: AlgorandLedgerTransactionRecord[];
  securityEvents: SecurityEventRecord[];
  memoryRecall: MemoryRecall | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("workflow");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Run details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close run details"
          className="-mr-1.5 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div role="tablist" aria-label="Run details" className="relative flex gap-6 border-b border-border px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative pb-3 pt-1 text-[13px] transition-colors",
              tab === t.id ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        {indicator && (
          <span
            aria-hidden
            className="absolute -bottom-px h-0.5 rounded-full bg-foreground transition-[left,width] duration-200 ease-out"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
      </div>

      <div key={tab} className="min-h-0 flex-1 animate-in fade-in duration-200">
        {tab === "workflow" &&
          (task ? (
            <WorkflowPanel
              subtasks={task.subtasks ?? []}
              isPlanning={task.status === "CREATED" || task.status === "PLANNING"}
              memoryRecall={memoryRecall}
              events={events}
            />
          ) : (
            <EmptyTab text="The agent network appears here once a task is running." />
          ))}
        {tab === "activity" && <ActivityList events={events} />}
        {tab === "economy" && (
          <EconomyContent
            task={task}
            ledger={ledger}
            paymentIntents={paymentIntents}
            blockchainTransactions={blockchainTransactions}
            blockchainWorkflowEvents={blockchainWorkflowEvents}
            algorandTransactions={algorandTransactions}
          />
        )}
      </div>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{text}</p>;
}
