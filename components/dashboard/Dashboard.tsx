"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useEventStream, type KravenEvent } from "@/lib/hooks/useEventStream";
import { Composer } from "@/components/dashboard/Composer";
import { DetailsDrawer } from "@/components/dashboard/DetailsDrawer";
import { MarketplacePanel } from "@/components/dashboard/MarketplacePanel";
import { OrgWorkspace } from "@/components/dashboard/OrgWorkspace";
import { RunThread } from "@/components/dashboard/RunThread";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { firebaseConfigured } from "@/lib/firebase";
import { useAuthUser } from "@/lib/use-auth-user";
import { greet } from "@/lib/greeting";
import { cn } from "@/lib/utils";
import { AlgorandModal } from "@/components/dashboard/AlgorandModal";
import type { AgentRecord, TaskRecord, CentralLedgerRecord, AlgorandLedgerTransactionRecord, SecurityEventRecord } from "@/lib/types";
import { Loader2, PanelLeftOpen, PanelRight, Zap } from "lucide-react";
import { toast } from "sonner";

const EXAMPLES: Array<{ title: string; prompt: string }> = [
  {
    title: "Market analysis",
    prompt: "Analyze the fintech startup market, identify three promising segments, estimate key financial metrics, and produce a concise investment-style report.",
  },
  {
    title: "Competitor comparison",
    prompt: "Compare the three leading project-management tools for small teams on pricing, strengths and weaknesses, and who each is best for.",
  },
  {
    title: "Go-to-market plan",
    prompt: "Draft a go-to-market plan for a B2B analytics SaaS product: target segments, channels, pricing approach, and 90-day milestones.",
  },
];

const ACTIVE_STATUSES = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);

// Seconds since the task was created - measured from its real start time, so
// reopening a task that is still running shows the true elapsed time.
function useElapsedSeconds(active: boolean, startedAt: string | undefined) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) {
      setSeconds(0);
      return;
    }
    const start = new Date(startedAt).getTime();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active, startedAt]);
  return seconds;
}

export function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const authorized = !firebaseConfigured || !!user;

  // Computed client-side only (not on the initial render) so the server's
  // clock/timezone never disagrees with the visitor's and causes a
  // hydration mismatch - starts blank and fills in right after mount.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greet(new Date().getHours(), user?.displayName));
  }, [user?.displayName]);

  useEffect(() => {
    if (firebaseConfigured && !authLoading && !user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  const { events } = useEventStream();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [ledger, setLedger] = useState<CentralLedgerRecord[]>([]);
  const [historicalEvents, setHistoricalEvents] = useState<KravenEvent[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<any[]>([]);
  const [blockchainTransactions, setBlockchainTransactions] = useState<any[]>([]);
  const [blockchainWorkflowEvents, setBlockchainWorkflowEvents] = useState<any[]>([]);
  const [algorandTransactions, setAlgorandTransactions] = useState<AlgorandLedgerTransactionRecord[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventRecord[]>([]);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [algorandModalOpen, setAlgorandModalOpen] = useState(false);
  const [mode, setMode] = useState<"user" | "org">("user");

  // Opens the task named by a shared ?task=<id> link (see Sidebar's "Share"),
  // and lets other pages (e.g. the Profile page's "Manage organization" link)
  // land directly in Organization mode instead of requiring a manual click.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("task");
    if (id) setTaskId(id);
    if (params.get("mode") === "org") setMode("org");
  }, []);

  // Layout. The sidebar is a column on desktop (collapsible) and an overlay on
  // small screens; the run-details drawer is closed until asked for.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [budget, setBudget] = useState(30);
  const [qualityThreshold, setQualityThreshold] = useState(70);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

  // The workspace uses its own flat palette (see .workspace in globals.css).
  // It is applied to <body> so portaled menus, tooltips and dialogs match.
  useEffect(() => {
    document.body.classList.add("workspace");
    return () => document.body.classList.remove("workspace");
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
      toast.error("Lost connection while checking task status - retrying shortly.");
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
      setSecurityEvents(data.securityEvents ?? []);
    } catch {
      // non-critical panel - fail silently, the next poll will retry
    }
  }

  // Backfills the activity feed with a task's persisted events - needed when
  // reopening a past chat, since the live SSE buffer only holds events seen
  // during the current browser session.
  async function refreshHistoricalEvents(id: string) {
    try {
      const res = await fetch(`/api/tasks/${id}/events`);
      const data = await res.json();
      setHistoricalEvents(data.events ?? []);
    } catch {
      // non-critical - the live stream still covers anything from here on
    }
  }

  function handleSelectFromHistory(id: string) {
    setTaskId(id);
    setMobileSidebarOpen(false);
  }

  useEffect(() => {
    refreshAgents();
  }, []);

  useEffect(() => {
    if (marketplaceOpen) refreshAgents();
  }, [marketplaceOpen]);

  // Refresh task/ledger snapshots whenever a relevant event lands for the
  // currently-selected task - the SSE stream tells us WHEN to refetch, the
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

  const taskEvents = useMemo(() => {
    const live = events.filter((e) => e.taskId === taskId);
    const merged = [...historicalEvents, ...live];
    const seen = new Set<string>();
    const deduped = merged.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    return deduped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [events, historicalEvents, taskId]);

  // Surfaces the Manager's real "I've seen something like this before" signal
  // (lib/manager/workflowMemory.ts) - the orchestrator emits this once, at
  // planning time, only when a genuinely similar past successful workflow
  // was found. Never fabricated: absent unless that lookup actually matched.
  const memoryRecall = useMemo(() => {
    const recalled = taskEvents.find(
      (e) => e.eventType === "WORKFLOW_MEMORY_STORED" && (e.payload as any)?.recalled === true,
    );
    if (!recalled) return null;
    const payload = recalled.payload as {
      similarity: number;
      agentsUsed: string[];
      historicalCost: number;
      historicalLatencyMs: number;
      historicalQuality: number;
    };
    return payload;
  }, [taskEvents]);

  const isRunning = task ? ACTIVE_STATUSES.has(task.status) : false;
  const elapsedSeconds = useElapsedSeconds(isRunning, task?.createdAt);

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

  // Starts a fresh chat by clearing only the client's current-task view state.
  // This does NOT call /api/reset and does NOT touch the database - past
  // tasks, ledger entries, events, and workflow memory all remain intact and
  // browsable from the History panel.
  function handleCreated(id: string) {
    setPrefill(null);
    setTaskId(id);
  }

  function handleNewTask() {
    setTaskId(null);
    setTask(null);
    setLedger([]);
    setHistoricalEvents([]);
    setMobileSidebarOpen(false);
    setPaymentIntents([]);
    setBlockchainTransactions([]);
    setBlockchainWorkflowEvents([]);
    setAlgorandTransactions([]);
    setSecurityEvents([]);
  }

  if (!authorized) {
    return <div className="fixed inset-0 bg-background" />;
  }

  const hasTask = taskId !== null;
  const title = task?.prompt ?? "";

  return (
    <div className="fixed inset-0 flex bg-background text-foreground">
      {/* Backdrop for the overlay panels on small screens */}
      {(mobileSidebarOpen || detailsOpen) && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => {
            setMobileSidebarOpen(false);
            setDetailsOpen(false);
          }}
          className="animate-in fade-in fixed inset-0 z-30 bg-black/50 duration-200 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-68 shrink-0 overflow-hidden border-r border-sidebar-border transition-[transform,width,border-color] duration-200 lg:static lg:z-auto lg:translate-x-0",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          desktopSidebarCollapsed && "lg:w-0 lg:border-transparent",
        )}
      >
        <Sidebar
          activeTaskId={taskId}
          refreshKey={`${taskId ?? "none"}:${task?.status ?? ""}`}
          mode={mode}
          onModeChange={(m) => {
            setMode(m);
            setMobileSidebarOpen(false);
            if (m === "user") refreshAgents();
          }}
          onSelect={(id) => {
            setMode("user");
            handleSelectFromHistory(id);
          }}
          onNewTask={() => {
            setMode("user");
            handleNewTask();
          }}
          onOpenAgents={() => {
            setMarketplaceOpen(true);
            setMobileSidebarOpen(false);
          }}
          onClose={() => {
            setMobileSidebarOpen(false);
            setDesktopSidebarCollapsed(true);
          }}
        />
      </aside>

      {/* Conversation / Organization */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(true);
              setDesktopSidebarCollapsed(false);
            }}
            aria-label="Open sidebar"
            title="Open sidebar"
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              !desktopSidebarCollapsed && "lg:hidden",
            )}
          >
            <PanelLeftOpen className="size-4.5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground" title={mode === "org" ? "My Organization" : title}>
            {mode === "org" ? "My Organization" : title}
          </div>
          <button
            type="button"
            onClick={() => setAlgorandModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-500 hover:bg-emerald-500/20 transition-colors shrink-0"
            title="View Algorand Mainnet & x402 Status"
          >
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold">Algorand Mainnet</span>
          </button>
          {mode === "user" && isRunning && (
            <span className="animate-in fade-in zoom-in-95 flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground duration-200">
              <Loader2 className="size-3 animate-spin" />
              Working · {elapsedSeconds}s
            </span>
          )}
          {mode === "user" && hasTask && (
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-pressed={detailsOpen}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                detailsOpen && "bg-muted text-foreground",
              )}
            >
              <PanelRight className="size-4" />
              <span className="hidden sm:inline">Run details</span>
            </button>
          )}
        </header>

        {mode === "org" ? (
          <OrgWorkspace />
        ) : (
          <>
        <div data-thread-scroller className="min-h-0 flex-1 overflow-y-auto">
          {!hasTask ? (
            <div className="animate-in fade-in mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 pb-16 pt-4 duration-300">
              {greeting && (
                <p className="animate-in fade-in mb-2 text-center text-sm font-medium text-muted-foreground duration-300">{greeting}</p>
              )}
              <h1 className="mb-8 text-center text-3xl font-semibold tracking-tight sm:text-[2rem]">
                Give me something{" "}
                <span className="font-(family-name:--font-accent) text-[1.35em] italic tracking-normal">hard</span>.
              </h1>
              <div className="w-full">
                <Composer
                  onCreated={handleCreated}
                  isRunning={isRunning}
                  onCancel={handleCancel}
                  budget={budget}
                  onBudgetChange={setBudget}
                  qualityThreshold={qualityThreshold}
                  onQualityThresholdChange={setQualityThreshold}
                  prefill={prefill}
                  autoFocus
                />
              </div>
              <p className="mt-3 max-w-xl text-center text-xs leading-relaxed text-muted-foreground">
                Kraven hires the right agents for your task within your budget, checks every result, and only pays for work that passes review.
              </p>
              <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-3">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.title}
                    type="button"
                    onClick={() => setPrefill({ text: example.prompt, nonce: Date.now() })}
                    className="rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="text-sm font-medium">{example.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{example.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : task ? (
            <RunThread key={task.id} task={task} events={taskEvents} elapsedSeconds={elapsedSeconds} memoryRecall={memoryRecall} />
          ) : (
            <div className="animate-in fade-in mx-auto flex max-w-3xl items-center gap-2 px-6 py-10 text-sm text-muted-foreground duration-300">
              <Loader2 className="size-4 animate-spin" /> Loading task…
            </div>
          )}
        </div>

        {hasTask && (
          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="mx-auto w-full max-w-3xl">
              <Composer
                onCreated={handleCreated}
                isRunning={isRunning}
                onCancel={handleCancel}
                budget={budget}
                onBudgetChange={setBudget}
                qualityThreshold={qualityThreshold}
                onQualityThresholdChange={setQualityThreshold}
              />
            </div>
          </div>
        )}
          </>
        )}
      </main>

      {/* Run details */}
      {/* Mounted only while open so the workflow graph measures a real container. */}
      {mode === "user" && hasTask && detailsOpen && (
        <aside className="animate-in slide-in-from-right-4 fade-in fixed inset-y-0 right-0 z-40 w-[min(26rem,100vw)] shrink-0 border-l border-border duration-200 lg:static lg:z-auto lg:w-104">
          <DetailsDrawer
            task={task}
            events={taskEvents}
            ledger={ledger}
            paymentIntents={paymentIntents}
            blockchainTransactions={blockchainTransactions}
            blockchainWorkflowEvents={blockchainWorkflowEvents}
            algorandTransactions={algorandTransactions}
            securityEvents={securityEvents}
            memoryRecall={memoryRecall}
            onClose={() => setDetailsOpen(false)}
          />
        </aside>
      )}

      <MarketplacePanel agents={agents} open={marketplaceOpen} onOpenChange={setMarketplaceOpen} />
      <AlgorandModal open={algorandModalOpen} onOpenChange={setAlgorandModalOpen} />
    </div>
  );
}
