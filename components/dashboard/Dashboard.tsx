"use client";

import { useEffect, useMemo, useState } from "react";
import { useEventStream, type MomentumEvent } from "@/lib/hooks/useEventStream";
import { FloatingChatBar } from "@/components/dashboard/FloatingChatBar";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { WorkflowPanel } from "@/components/dashboard/WorkflowPanel";
import { EconomyPanel } from "@/components/dashboard/EconomyPanel";
import { FinalOutputPanel } from "@/components/dashboard/FinalOutputPanel";
import { RogueDemoButton } from "@/components/dashboard/RogueDemoButton";
import { ChatHistoryPanel } from "@/components/dashboard/ChatHistoryPanel";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { firebaseConfigured } from "@/lib/firebase";
import { PromptOptimizationPanel } from "@/components/dashboard/PromptOptimizationPanel";
import type { AgentRecord, TaskRecord, CentralLedgerRecord, AlgorandLedgerTransactionRecord } from "@/lib/types";
import { FileText, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const ACTIVE_STATUSES = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return seconds;
}

export function Dashboard() {
  const { events } = useEventStream();
  const [, setAgents] = useState<AgentRecord[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [ledger, setLedger] = useState<CentralLedgerRecord[]>([]);
  const [historicalEvents, setHistoricalEvents] = useState<MomentumEvent[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<any[]>([]);
  const [blockchainTransactions, setBlockchainTransactions] = useState<any[]>([]);
  const [blockchainWorkflowEvents, setBlockchainWorkflowEvents] = useState<any[]>([]);
  const [algorandTransactions, setAlgorandTransactions] = useState<AlgorandLedgerTransactionRecord[]>([]);
  const [resetting, setResetting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [economyOpen, setEconomyOpen] = useState(true);

  // On narrow viewports the two side panels are full-width, so only one may
  // be open at a time or they visually stack on top of each other. On wider
  // viewports both can stay open simultaneously as originally designed.
  function handleActivityOpenChange(next: boolean) {
    setActivityOpen(next);
    if (next && typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
      setEconomyOpen(false);
    }
  }
  function handleEconomyOpenChange(next: boolean) {
    setEconomyOpen(next);
    if (next && typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
      setActivityOpen(false);
    }
  }

  // Both panels default to open (desktop has room for both side by side),
  // but on a narrow viewport they'd fully overlap — collapse Economy on
  // mount there so the initial view isn't obscured.
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      setEconomyOpen(false);
    }
  }, []);

  // Block native page-zoom everywhere (not just over the canvas): Safari's
  // trackpad pinch fires non-standard gesture events instead of wheel, and
  // ctrl+wheel (trackpad pinch on Chrome/Firefox) can also reach the page
  // outside the canvas, over the side panels or chat bar.
  useEffect(() => {
    function preventGesture(e: Event) {
      e.preventDefault();
    }
    function preventCtrlWheel(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    document.addEventListener("wheel", preventCtrlWheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("wheel", preventCtrlWheel);
    };
  }, []);

  async function refreshAgents() {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      toast.error("Couldn't reach the server to load agents.");
    }
  }

  async function refreshTask(id: string) {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      const data = await res.json();
      if (res.ok) setTask(data.task);
    } catch {
      toast.error("Lost connection while checking task status — retrying shortly.");
    }
  }

  async function refreshLedger(id: string) {
    try {
      const res = await fetch(`/api/transactions?taskId=${id}`);
      const data = await res.json();
      setLedger(data.transactions ?? []);
      setPaymentIntents(data.paymentIntents ?? []);
      setBlockchainTransactions(data.blockchainTransactions ?? []);
      setBlockchainWorkflowEvents(data.blockchainWorkflowEvents ?? []);
      setAlgorandTransactions(data.algorandTransactions ?? []);
    } catch {
      // non-critical panel — fail silently, the next poll will retry
    }
  }

  // Backfills the activity feed with a task's persisted events — needed when
  // reopening a past chat, since the live SSE buffer only holds events seen
  // during the current browser session.
  async function refreshHistoricalEvents(id: string) {
    try {
      const res = await fetch(`/api/tasks/${id}/events`);
      const data = await res.json();
      setHistoricalEvents(data.events ?? []);
    } catch {
      // non-critical — the live stream still covers anything from here on
    }
  }

  function handleSelectFromHistory(id: string) {
    setTaskId(id);
  }

  useEffect(() => {
    refreshAgents();
  }, []);

  // Refresh task/ledger snapshots whenever a relevant event lands for the
  // currently-selected task — the SSE stream tells us WHEN to refetch, the
  // REST endpoints remain the source of truth for full record shape.
  useEffect(() => {
    if (!taskId) return;
    const last = events[events.length - 1];
    if (!last || last.taskId !== taskId) return;
    refreshTask(taskId);
    refreshLedger(taskId);
    refreshAgents();
  }, [events, taskId]);

  useEffect(() => {
    if (!taskId) return;
    refreshTask(taskId);
    refreshLedger(taskId);
    refreshHistoricalEvents(taskId);
    const interval = setInterval(() => {
      refreshTask(taskId);
    }, 3000);
    return () => clearInterval(interval);
  }, [taskId]);

  useEffect(() => {
    if (task && TERMINAL_STATUSES.has(task.status) && task.finalOutput) {
      setReportOpen(true);
    }
  }, [task?.status, task?.finalOutput]);

  const taskEvents = useMemo(() => {
    const live = events.filter((e) => e.taskId === taskId);
    const merged = [...historicalEvents, ...live];
    const seen = new Set<string>();
    const deduped = merged.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    return deduped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [events, historicalEvents, taskId]);

  const isRunning = task ? ACTIVE_STATUSES.has(task.status) : false;
  const elapsedSeconds = useElapsedSeconds(isRunning);

  async function handleCancel() {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't cancel the task.");
      }
    } catch {
      toast.error("Couldn't reach the server to cancel the task.");
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setTaskId(null);
      setTask(null);
      setLedger([]);
      setHistoricalEvents([]);
      setReportOpen(false);
      setPaymentIntents([]);
      setBlockchainTransactions([]);
      setBlockchainWorkflowEvents([]);
      await refreshAgents();
    } catch {
      toast.error("Couldn't reach the server to reset the demo.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-canvas">
      {/* Full-screen workflow canvas */}
      <div className="absolute inset-0">
        <WorkflowPanel subtasks={task?.subtasks ?? []} isPlanning={task?.status === "CREATED" || task?.status === "PLANNING"} />
      </div>

      {/* Floating top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-end gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 rounded-md border border-panel-border bg-panel p-1 shadow-lg backdrop-blur-xl transition-colors">
          {task?.finalOutput && (
            <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)} className="text-panel-foreground hover:bg-panel-elevated">
              <FileText className="size-3.5" /> <span className="hidden sm:inline">Report</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} className="text-panel-foreground hover:bg-panel-elevated">
            <History className="size-3.5" /> <span className="hidden sm:inline">History</span>
          </Button>
          <RogueDemoButton key={taskId ?? "none"} taskId={taskId} />
          <Button variant="ghost" size="sm" onClick={handleReset} disabled={resetting} className="text-panel-foreground hover:bg-panel-elevated">
            <RotateCcw className="size-3.5" /> <span className="hidden sm:inline">Reset</span>
          </Button>
          <ThemeToggle />
          {firebaseConfigured && (
            <>
              <Separator orientation="vertical" className="h-5 bg-panel-border" />
              <UserMenu />
            </>
          )}
        </div>
      </header>

      <ActivityFeed events={taskEvents} open={activityOpen} onOpenChange={handleActivityOpenChange} />
      <EconomyPanel
        task={task}
        ledger={ledger}
        paymentIntents={paymentIntents}
        blockchainTransactions={blockchainTransactions}
        blockchainWorkflowEvents={blockchainWorkflowEvents}
        algorandTransactions={algorandTransactions}
        open={economyOpen}
        onOpenChange={handleEconomyOpenChange}
      />

      <FloatingChatBar onCreated={setTaskId} disabled={isRunning} isRunning={isRunning} elapsedSeconds={elapsedSeconds} onCancel={handleCancel} />

      <FinalOutputPanel task={task} open={reportOpen} onOpenChange={setReportOpen} />
      <PromptOptimizationPanel task={task} />
      <ChatHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} activeTaskId={taskId} onSelect={handleSelectFromHistory} />
    </div>
  );
}
