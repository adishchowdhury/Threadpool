"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KravenEvent } from "@/lib/hooks/useEventStream";
import type { SubtaskRecord, TaskRecord } from "@/lib/types";
import { TaskResult } from "@/components/dashboard/ReportCard";
import { tokensWorthLabel } from "@/lib/economy/tokenValue";
import { cn } from "@/lib/utils";
import { WorkflowPanel } from "@/components/dashboard/WorkflowPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Check, ChevronDown, Circle, Copy, Fullscreen, Loader2, Network, X } from "lucide-react";
import { toast } from "sonner";

const ACTIVE = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);

interface MemoryRecall {
  similarity: number;
  historicalCost: number;
  historicalQuality: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function humanize(slug: string): string {
  const text = slug.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type StepState = "waiting" | "active" | "done" | "failed";

function stepState(s: SubtaskRecord): StepState {
  if (s.status === "DONE") return "done";
  if (s.status === "FAILED") return "failed";
  if (s.status === "PENDING") return "waiting";
  return "active";
}

function stepText(s: SubtaskRecord): string {
  const agent = s.assignedAgent?.name;
  switch (s.status) {
    case "PENDING":
      return "Waiting for earlier steps";
    case "BIDDING":
      return "Finding the best agent for this step";
    case "ASSIGNED":
      return agent ? `${agent} hired - payment held until the work passes review` : "Agent hired";
    case "EXECUTING":
      return `${agent ?? "Agent"} is working${s.attemptCount > 1 ? ` (attempt ${s.attemptCount})` : ""}`;
    case "AWAITING_QA":
      return "Independent quality review in progress";
    case "DONE":
      return `Approved${s.qaScore != null ? ` · review score ${s.qaScore}/100` : ""}${s.attemptCount > 1 ? ` · after ${s.attemptCount} attempts` : ""}`;
    case "FAILED":
      return s.qaReason ? `Didn't pass review - ${s.qaReason}` : "Didn't pass review";
    default:
      return s.status;
  }
}

function StatusIcon({ state }: { state: StepState | "planning" }) {
  const base = "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-300";
  if (state === "done")
    return (
      <span className={cn(base, "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (state === "failed")
    return (
      <span className={cn(base, "bg-destructive/15 text-destructive")}>
        <X className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (state === "active" || state === "planning")
    return (
      <span className={cn(base, "bg-foreground/10 text-foreground")}>
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  return (
    <span className={cn(base, "text-muted-foreground/60")}>
      <Circle className="size-3.5" />
    </span>
  );
}

interface StepEvents {
  discovered?: number;
  stages?: Array<{ stage: string; count: number; relaxed?: boolean }>;
  explanation?: string;
}

function collectStepEvents(events: KravenEvent[]): Map<string, StepEvents> {
  const map = new Map<string, StepEvents>();
  const entry = (id: string) => {
    let e = map.get(id);
    if (!e) {
      e = {};
      map.set(id, e);
    }
    return e;
  };
  for (const ev of events) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const id = typeof p.subtaskId === "string" ? p.subtaskId : null;
    if (!id) continue;
    if (ev.eventType === "AGENTS_DISCOVERED") entry(id).discovered = Number(p.count);
    else if (ev.eventType === "AGENTS_FILTERED") entry(id).stages = Array.isArray(p.stages) ? (p.stages as StepEvents["stages"]) : undefined;
    else if (ev.eventType === "AGENT_SELECTED") entry(id).explanation = typeof p.explanation === "string" ? p.explanation : undefined;
  }
  return map;
}

function Step({ subtask, extra, last }: { subtask: SubtaskRecord; extra?: StepEvents; last: boolean }) {
  const state = stepState(subtask);
  const agent = subtask.assignedAgent;
  const hasWhy = Boolean(extra?.explanation || extra?.stages);
  return (
    <li className="relative flex animate-in fade-in slide-in-from-top-1 gap-3 pb-5 duration-300 last:pb-0">
      {!last && <span aria-hidden className="absolute left-3 top-6 -ml-px h-[calc(100%-1.5rem)] w-px bg-border" />}
      <StatusIcon state={state} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("text-sm font-medium", state === "waiting" && "text-muted-foreground")}>{humanize(subtask.type)}</span>
          {agent && (
            <span className="text-xs text-muted-foreground">
              {agent.name} · {agent.price} token{agent.price === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className={cn("text-xs leading-relaxed", state === "failed" ? "text-destructive" : "text-muted-foreground")}>{stepText(subtask)}</div>
        {hasWhy && (
          <details className="group/why mt-1.5">
            <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Why this agent?
              <ChevronDown className="size-3 transition-transform group-open/why:rotate-180" />
            </summary>
            <div className="mt-1.5 animate-in fade-in slide-in-from-top-1 space-y-1.5 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground duration-200">
              {extra?.stages && (
                <div className="flex flex-wrap items-center gap-1">
                  {extra.stages.map((st, i) => (
                    <span key={st.stage} className="inline-flex items-center gap-1">
                      {i > 0 && <span aria-hidden>→</span>}
                      <span>
                        {st.stage} <span className="font-mono text-foreground">{st.count}</span>
                        {st.relaxed ? " (relaxed)" : ""}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {extra?.explanation && <div>{extra.explanation}</div>}
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

// The live agent network, inline in the conversation. Open while work is in
// progress (this is where watching agents get hired pays off) and tucked away
// once the report is ready; the person's own toggle always wins. The graph is
// mounted only while open so it measures a real container.
function NetworkCard({
  task,
  events,
  running,
}: {
  task: TaskRecord;
  events: KravenEvent[];
  running: boolean;
}) {
  const subtasks = task.subtasks ?? [];
  // Follows the run (open while working, closed when done) until the person
  // toggles it; the parent keys this component by task so state resets per task.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? running;
  const [fullscreen, setFullscreen] = useState(false);

  const agents = new Set(subtasks.map((s) => s.assignedAgentId).filter(Boolean)).size;
  const done = subtasks.filter((s) => s.status === "DONE").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="flex items-center gap-2 px-4 py-3 text-sm">
        <button
          type="button"
          onClick={() => setUserOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <Network className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">Agent network</span>
          <span className="truncate text-muted-foreground">
            {agents} agent{agents === 1 ? "" : "s"} · {done} of {subtasks.length} steps
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Open agent network full screen"
          title="Full screen"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Fullscreen className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setUserOpen(!open)}
          aria-label={open ? "Hide agent network" : "Show agent network"}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && !fullscreen && (
        <div className="h-96 animate-in fade-in slide-in-from-top-1 border-t border-border duration-300 ease-out">
          <WorkflowPanel subtasks={subtasks} isPlanning={false} memoryRecall={null} events={events} />
        </div>
      )}

      {/* Full-screen view: same live graph, with room to read every node. */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="h-[94vh] w-[97vw] max-w-[97vw] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-[97vw]">
          <div className="px-5 py-3.5 pr-14">
            <DialogTitle className="text-sm font-medium">Agent network</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {agents} agent{agents === 1 ? "" : "s"} · {done} of {subtasks.length} steps. Drag to pan, scroll or pinch to zoom, hover a node for details. Esc to close.
            </DialogDescription>
          </div>
          <div className="min-h-0 border-t border-border">
            <WorkflowPanel subtasks={subtasks} isPlanning={false} memoryRecall={null} events={events} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RunThread({
  task,
  events,
  elapsedSeconds,
  memoryRecall,
}: {
  task: TaskRecord;
  events: KravenEvent[];
  elapsedSeconds: number;
  memoryRecall: MemoryRecall | null;
}) {
  const subtasks = task.subtasks ?? [];
  const running = ACTIVE.has(task.status);
  const planning = running && subtasks.length === 0;
  const stepEvents = useMemo(() => collectStepEvents(events), [events]);

  // The step list stays open while work is in progress and tucks away once a
  // result exists; whatever the person toggles afterwards is respected.
  const [userStepsOpen, setUserStepsOpen] = useState<boolean | null>(null);
  const stepsOpen = userStepsOpen ?? running;
  const [promptCopied, setPromptCopied] = useState(false);

  // Opening a task starts at its top. While work is in progress the newest
  // step is kept in view - unless the person has scrolled up to read.
  const endRef = useRef<HTMLDivElement | null>(null);
  const getScroller = () => endRef.current?.closest("[data-thread-scroller]") as HTMLElement | null;
  useEffect(() => {
    getScroller()?.scrollTo({ top: 0 });
  }, [task.id]);
  const signature = `${task.status}|${subtasks.map((s) => s.status).join(",")}`;
  useEffect(() => {
    const scroller = getScroller();
    if (!running || !scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 240) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [signature, running]);

  const doneCount = subtasks.filter((s) => s.status === "DONE").length;
  const agentCount = new Set(subtasks.map((s) => s.assignedAgentId).filter(Boolean)).size;
  const summary = running
    ? planning
      ? "Understanding your task…"
      : `Working · ${doneCount} of ${subtasks.length} steps done · ${elapsedSeconds}s`
    : `${subtasks.length} steps · ${agentCount} agent${agentCount === 1 ? "" : "s"}`;

  return (
    <div className="animate-in fade-in mx-auto w-full max-w-3xl space-y-7 px-4 py-8 duration-300 sm:px-6">
      {/* The request */}
      <div className="flex flex-col items-end gap-1.5">
        <div className="max-w-[88%] rounded-3xl bg-muted px-5 py-3 text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap">{task.prompt}</div>
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <span>
            Budget {task.budget} tokens ({tokensWorthLabel(task.budget)}) · Quality bar {task.qualityThreshold}
          </span>
          <span aria-hidden>·</span>
          <span>{formatTime(task.createdAt)}</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(task.prompt);
                setPromptCopied(true);
                toast.success("Prompt copied to clipboard");
                setTimeout(() => setPromptCopied(false), 1800);
              } catch {
                toast.error("Couldn't copy - clipboard access was denied.");
              }
            }}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:text-foreground"
          >
            {promptCopied ? (
              <Check className="size-3 animate-in zoom-in-50 text-emerald-500 duration-200" />
            ) : (
              <Copy className="size-3" />
            )}
            {promptCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* The workforce's response */}
      <div className="flex gap-3.5">
        <div
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
        >
          K
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <details
            open={stepsOpen}
            onToggle={(e) => {
              const next = (e.currentTarget as HTMLDetailsElement).open;
              if (next !== stepsOpen) setUserStepsOpen(next);
            }}
            className="group rounded-2xl border border-border"
          >
            <summary className="flex cursor-pointer select-none list-none items-center gap-2.5 px-4 py-3 text-sm">
              {running ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : task.status === "COMPLETED" ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
              ) : task.status === "PARTIAL" ? (
                <Check className="size-4 text-amber-600 dark:text-amber-400" strokeWidth={3} />
              ) : (
                <X className="size-4 text-muted-foreground" />
              )}
              <span className="font-medium">{summary}</span>
              <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div className="animate-in fade-in slide-in-from-top-1 border-t border-border px-4 py-4 duration-200">
              <ul>
                <li className="relative flex gap-3 pb-5">
                  {subtasks.length > 0 && <span aria-hidden className="absolute left-3 top-6 -ml-px h-[calc(100%-1.5rem)] w-px bg-border" />}
                  <StatusIcon state={planning ? "planning" : "done"} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="text-sm font-medium">Understanding the task</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {planning ? "Breaking your request into steps" : `Split into ${subtasks.length} step${subtasks.length === 1 ? "" : "s"}`}
                      {memoryRecall && ` · reusing what worked on a similar task (${Math.round(memoryRecall.similarity * 100)}% match)`}
                    </div>
                  </div>
                </li>
                {subtasks.map((s, i) => (
                  <Step key={s.id} subtask={s} extra={stepEvents.get(s.id)} last={i === subtasks.length - 1} />
                ))}
              </ul>
            </div>
          </details>

          {subtasks.length > 0 && <NetworkCard key={task.id} task={task} events={events} running={running} />}

          {!running && <TaskResult task={task} />}
        </div>
      </div>
      <div ref={endRef} />
    </div>
  );
}
