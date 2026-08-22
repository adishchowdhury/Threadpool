"use client";

import { useEffect, useMemo, useState } from "react";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { TaskForm } from "@/components/dashboard/TaskForm";
import { AgentRegistryPanel } from "@/components/dashboard/AgentRegistryPanel";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { WorkflowPanel } from "@/components/dashboard/WorkflowPanel";
import { EconomyPanel } from "@/components/dashboard/EconomyPanel";
import { FinalOutputPanel } from "@/components/dashboard/FinalOutputPanel";
import { RogueDemoButton } from "@/components/dashboard/RogueDemoButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentRecord, TaskRecord, CentralLedgerRecord } from "@/lib/types";
import { RotateCcw, Zap } from "lucide-react";

const ACTIVE_STATUSES = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);

export function Dashboard() {
  const { events, connected } = useEventStream();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [ledger, setLedger] = useState<CentralLedgerRecord[]>([]);
  const [resetting, setResetting] = useState(false);

  async function refreshAgents() {
    const res = await fetch("/api/agents");
    const data = await res.json();
    setAgents(data.agents ?? []);
  }

  async function refreshTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`);
    const data = await res.json();
    if (res.ok) setTask(data.task);
  }

  async function refreshLedger(id: string) {
    const res = await fetch(`/api/transactions?taskId=${id}`);
    const data = await res.json();
    setLedger(data.transactions ?? []);
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
    const interval = setInterval(() => {
      refreshTask(taskId);
    }, 3000);
    return () => clearInterval(interval);
  }, [taskId]);

  const taskEvents = useMemo(() => events.filter((e) => e.taskId === taskId), [events, taskId]);

  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of taskEvents) {
      if (["BID_RECEIVED", "AGENT_SELECTED", "WORK_STARTED"].includes(e.eventType)) {
        const p = e.payload as { agentId?: string };
        if (p?.agentId) ids.add(p.agentId);
      }
    }
    return ids;
  }, [taskEvents]);

  const selectedAgentIds = useMemo(() => {
    return new Set((task?.subtasks ?? []).map((s) => s.assignedAgentId).filter((x): x is string => Boolean(x)));
  }, [task]);

  const isRunning = task ? ACTIVE_STATUSES.has(task.status) : false;

  async function handleCancel() {
    if (!taskId) return;
    await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  }

  async function handleReset() {
    setResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setTaskId(null);
      setTask(null);
      setLedger([]);
      await refreshAgents();
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Momentum — AI Workforce Command Center</h1>
          <Badge variant={connected ? "secondary" : "outline"} className="ml-2 text-[10px]">
            {connected ? "live" : "connecting..."}
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting}>
          <RotateCcw className="size-3.5" /> Reset Demo
        </Button>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4 p-4">
        <div className="space-y-4">
          <TaskForm onCreated={setTaskId} disabled={isRunning} />
          {isRunning && (
            <Button variant="outline" className="w-full" onClick={handleCancel}>
              Cancel Running Task
            </Button>
          )}
          <RogueDemoButton key={taskId ?? "none"} taskId={taskId} />
          <AgentRegistryPanel agents={agents} activeAgentIds={activeAgentIds} selectedAgentIds={selectedAgentIds} />
        </div>

        <div className="space-y-4">
          <WorkflowPanel subtasks={task?.subtasks ?? []} />
          <FinalOutputPanel task={task} />
        </div>

        <div className="space-y-4">
          <EconomyPanel task={task} ledger={ledger} />
          <ActivityFeed events={taskEvents} />
        </div>
      </main>
    </div>
  );
}
