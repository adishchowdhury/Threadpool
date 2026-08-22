"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SubtaskRecord } from "@/lib/types";
import {
  Bot,
  CheckCircle2,
  Clock3,
  GitBranch,
  Loader2,
  Maximize,
  MessageSquareText,
  Minus,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";

const NODE_WIDTH = 164;
const NODE_HEIGHT = 84;
const CANVAS_HEIGHT = 460;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2;

type StatusTone = {
  chip: string;
  node: string;
  glow: string;
  edge: string;
  icon: string;
};

type GraphNode = {
  id: string;
  title: string;
  eyebrow: string;
  detail: string;
  status: string;
  x: number;
  y: number;
  kind: "trigger" | "task" | "agent" | "qa" | "output";
  subtask?: SubtaskRecord;
};

type GraphEdge = {
  id: string;
  from: GraphNode;
  to: GraphNode;
  active?: boolean;
  dashed?: boolean;
  label?: string;
};

const ACTIVE_STATUSES = new Set(["BIDDING", "ASSIGNED", "EXECUTING", "AWAITING_QA"]);

const STATUS_TONES: Record<string, StatusTone> = {
  READY: {
    chip: "bg-neutral-900/8 text-neutral-900 ring-neutral-900/15 dark:bg-white/12 dark:text-neutral-100 dark:ring-white/20",
    node: "border-neutral-900/20 bg-white/90 dark:border-white/25 dark:bg-neutral-900/70",
    glow: "shadow-[0_0_18px_rgba(0,0,0,0.08)] dark:shadow-[0_0_24px_rgba(255,255,255,0.12)]",
    edge: "stroke-neutral-800/70 dark:stroke-white/70",
    icon: "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950",
  },
  PENDING: {
    chip: "bg-neutral-500/10 text-neutral-600 ring-neutral-400/20 dark:bg-neutral-400/12 dark:text-neutral-300 dark:ring-neutral-300/15",
    node: "border-neutral-300 bg-white/90 dark:border-neutral-700/80 dark:bg-neutral-900/88",
    glow: "",
    edge: "stroke-neutral-400/55 dark:stroke-neutral-500/45",
    icon: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  },
  BIDDING: {
    chip: "bg-blue-500/10 text-blue-700 ring-blue-400/25 dark:bg-blue-400/15 dark:text-blue-200 dark:ring-blue-300/25",
    node: "border-blue-400/50 bg-blue-50/90 dark:border-blue-300/45 dark:bg-blue-950/45",
    glow: "shadow-[0_0_20px_rgba(59,130,246,0.14)] dark:shadow-[0_0_30px_rgba(96,165,250,0.18)]",
    edge: "stroke-blue-500/80 dark:stroke-blue-300/80",
    icon: "bg-blue-500 text-white dark:bg-blue-400 dark:text-neutral-950",
  },
  ASSIGNED: {
    chip: "bg-cyan-500/10 text-cyan-700 ring-cyan-400/25 dark:bg-cyan-400/15 dark:text-cyan-100 dark:ring-cyan-300/25",
    node: "border-cyan-400/50 bg-cyan-50/90 dark:border-cyan-300/45 dark:bg-cyan-950/40",
    glow: "shadow-[0_0_20px_rgba(34,211,238,0.12)] dark:shadow-[0_0_30px_rgba(34,211,238,0.16)]",
    edge: "stroke-cyan-500/80 dark:stroke-cyan-300/80",
    icon: "bg-cyan-500 text-white dark:bg-cyan-300 dark:text-neutral-950",
  },
  EXECUTING: {
    chip: "bg-amber-500/10 text-amber-700 ring-amber-400/25 dark:bg-amber-300/15 dark:text-amber-100 dark:ring-amber-200/25",
    node: "border-amber-400/60 bg-amber-50/90 dark:border-amber-200/50 dark:bg-amber-950/35",
    glow: "shadow-[0_0_22px_rgba(251,191,36,0.16)] dark:shadow-[0_0_34px_rgba(251,191,36,0.22)]",
    edge: "stroke-amber-500/85 dark:stroke-amber-200/85",
    icon: "bg-amber-500 text-white dark:bg-amber-300 dark:text-neutral-950",
  },
  AWAITING_QA: {
    chip: "bg-violet-500/10 text-violet-700 ring-violet-400/25 dark:bg-violet-300/15 dark:text-violet-100 dark:ring-violet-200/25",
    node: "border-violet-400/60 bg-violet-50/90 dark:border-violet-200/50 dark:bg-violet-950/40",
    glow: "shadow-[0_0_22px_rgba(167,139,250,0.14)] dark:shadow-[0_0_34px_rgba(167,139,250,0.2)]",
    edge: "stroke-violet-500/85 dark:stroke-violet-200/85",
    icon: "bg-violet-500 text-white dark:bg-violet-300 dark:text-neutral-950",
  },
  DONE: {
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-400/25 dark:bg-emerald-300/15 dark:text-emerald-100 dark:ring-emerald-200/25",
    node: "border-emerald-400/50 bg-emerald-50/90 dark:border-emerald-200/45 dark:bg-emerald-950/35",
    glow: "shadow-[0_0_18px_rgba(52,211,153,0.12)] dark:shadow-[0_0_28px_rgba(52,211,153,0.16)]",
    edge: "stroke-emerald-500/80 dark:stroke-emerald-200/80",
    icon: "bg-emerald-500 text-white dark:bg-emerald-300 dark:text-neutral-950",
  },
  FAILED: {
    chip: "bg-rose-500/10 text-rose-700 ring-rose-400/25 dark:bg-rose-300/15 dark:text-rose-100 dark:ring-rose-200/25",
    node: "border-rose-400/60 bg-rose-50/90 dark:border-rose-200/50 dark:bg-rose-950/40",
    glow: "shadow-[0_0_22px_rgba(251,113,133,0.14)] dark:shadow-[0_0_34px_rgba(251,113,133,0.2)]",
    edge: "stroke-rose-500/85 dark:stroke-rose-200/85",
    icon: "bg-rose-500 text-white dark:bg-rose-300 dark:text-neutral-950",
  },
  WAITING: {
    chip: "bg-neutral-500/10 text-neutral-600 ring-neutral-400/20 dark:bg-neutral-400/12 dark:text-neutral-300 dark:ring-neutral-300/15",
    node: "border-neutral-300 bg-white/90 dark:border-neutral-700/80 dark:bg-neutral-900/88",
    glow: "",
    edge: "stroke-neutral-400/55 dark:stroke-neutral-500/45",
    icon: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  },
};

function statusTone(status: string) {
  return STATUS_TONES[status] ?? STATUS_TONES.WAITING;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "DONE") return <CheckCircle2 className="size-3.5" />;
  if (status === "FAILED") return <XCircle className="size-3.5" />;
  if (ACTIVE_STATUSES.has(status)) return <Loader2 className="size-3.5 animate-spin" />;
  return <Clock3 className="size-3.5" />;
}

function shortLabel(value: string, fallback: string) {
  const compact = value.trim().replace(/[_-]+/g, " ");
  return compact.length > 0 ? compact : fallback;
}

function buildGraph(subtasks: SubtaskRecord[]) {
  const sorted = subtasks.slice().sort((a, b) => a.sequence - b.sequence);
  const width = Math.max(780, 300 + sorted.length * 212);
  const trigger: GraphNode = {
    id: "trigger",
    title: "Task Trigger",
    eyebrow: "Manual start",
    detail: "Manager receives prompt",
    status: "READY",
    x: 34,
    y: 176,
    kind: "trigger",
  };
  const output: GraphNode = {
    id: "output",
    title: "Final Output",
    eyebrow: "Response",
    detail: "Verified result",
    status: sorted.length > 0 && sorted.every((s) => s.status === "DONE") ? "DONE" : "WAITING",
    x: width - 194,
    y: 176,
    kind: "output",
  };

  const taskNodes = sorted.map<GraphNode>((subtask, index) => ({
    id: subtask.id,
    title: shortLabel(subtask.type, `Step ${index + 1}`),
    eyebrow: `Step ${index + 1}`,
    detail: shortLabel(subtask.requiredCapability, "Capability pending"),
    status: subtask.status,
    x: 220 + index * 212,
    y: index % 2 === 0 ? 108 : 220,
    kind: "task",
    subtask,
  }));

  const agentNodes = taskNodes
    .filter((node) => node.subtask?.assignedAgent)
    .map<GraphNode>((node) => ({
      id: `${node.id}-agent`,
      title: node.subtask?.assignedAgent?.name ?? "Assigned Agent",
      eyebrow: "Worker",
      detail: `Rep ${node.subtask?.assignedAgent?.reputation ?? 0}`,
      status: node.status,
      x: node.x + 18,
      y: 334,
      kind: "agent",
      subtask: node.subtask,
    }));

  const qaNodes = taskNodes
    .filter((node) => node.subtask?.qaScore != null || node.status === "AWAITING_QA")
    .map<GraphNode>((node) => ({
      id: `${node.id}-qa`,
      title: "Quality Gate",
      eyebrow: "QA",
      detail: node.subtask?.qaScore != null ? `${node.subtask.qaScore}/100` : "Reviewing",
      status: node.status === "DONE" ? "DONE" : "AWAITING_QA",
      x: node.x + 18,
      y: 22,
      kind: "qa",
      subtask: node.subtask,
    }));

  const mainNodes = [trigger, ...taskNodes, output];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < mainNodes.length - 1; i += 1) {
    const from = mainNodes[i];
    const to = mainNodes[i + 1];
    const active = from.status === "READY" || from.status === "DONE" || ACTIVE_STATUSES.has(to.status) || to.status === "DONE";
    edges.push({
      id: `${from.id}-${to.id}`,
      from,
      to,
      active,
      label: i === 0 ? "plan" : undefined,
    });
  }

  for (const node of agentNodes) {
    const taskNode = taskNodes.find((task) => `${task.id}-agent` === node.id);
    if (taskNode) {
      edges.push({ id: `${taskNode.id}-agent-edge`, from: taskNode, to: node, active: ACTIVE_STATUSES.has(taskNode.status), dashed: true, label: "hire" });
    }
  }

  for (const node of qaNodes) {
    const taskNode = taskNodes.find((task) => `${task.id}-qa` === node.id);
    if (taskNode) {
      edges.push({ id: `${taskNode.id}-qa-edge`, from: taskNode, to: node, active: taskNode.status === "AWAITING_QA" || taskNode.status === "DONE", dashed: true, label: "qa" });
    }
  }

  return { nodes: [...mainNodes, ...agentNodes, ...qaNodes], edges, width, height: CANVAS_HEIGHT };
}

function connectorPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + NODE_HEIGHT / 2;
  const bend = Math.max(60, Math.abs(endX - startX) * 0.45);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function centerPoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    x: (from.x + NODE_WIDTH + to.x) / 2,
    y: (from.y + NODE_HEIGHT / 2 + to.y + NODE_HEIGHT / 2) / 2,
  };
}

function NodeIcon({ node }: { node: GraphNode }) {
  if (node.kind === "trigger") return <Play className="size-4" />;
  if (node.kind === "agent") return <Bot className="size-4" />;
  if (node.kind === "qa") return <ShieldCheck className="size-4" />;
  if (node.kind === "output") return <MessageSquareText className="size-4" />;
  return <Sparkles className="size-4" />;
}

function WorkflowNode({
  node,
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  node: GraphNode;
  pos: { x: number; y: number };
  selected: boolean;
  onSelect: (node: GraphNode) => void;
  onDragStart: (node: GraphNode, e: ReactPointerEvent) => void;
}) {
  const tone = statusTone(node.status);
  const isActive = ACTIVE_STATUSES.has(node.status);

  return (
    <div
      onPointerDown={(e) => onDragStart(node, e)}
      onClick={() => onSelect(node)}
      className={cn(
        "absolute cursor-grab select-none rounded-lg border p-2.5 text-left text-neutral-900 shadow-sm transition-shadow duration-200 active:cursor-grabbing dark:text-neutral-100 dark:shadow-none",
        tone.node,
        tone.glow,
        selected && "ring-2 ring-neutral-900/60 dark:ring-white/70",
        isActive && "scale-[1.01]",
      )}
      style={{ left: pos.x, top: pos.y, width: NODE_WIDTH, height: NODE_HEIGHT, touchAction: "none" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", tone.icon)}>
            <NodeIcon node={node} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase text-neutral-500 dark:text-neutral-400">{node.eyebrow}</div>
            <div className="truncate text-sm font-medium leading-5 tracking-tight">{node.title}</div>
          </div>
        </div>
        <span className={cn("grid size-5 shrink-0 place-items-center rounded-full ring-1", tone.chip)}>
          <StatusIcon status={node.status} />
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        <span className="h-px flex-1 bg-neutral-300 dark:bg-neutral-600/70" />
        <span className="max-w-[120px] truncate">{node.detail}</span>
      </div>
      {isActive && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.6)] dark:bg-amber-200 dark:shadow-[0_0_18px_rgba(253,224,71,0.9)]" />}
      <span className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rounded-full border border-neutral-400 bg-white dark:border-neutral-300 dark:bg-neutral-950" />
      <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full border border-neutral-400 bg-white dark:border-neutral-300 dark:bg-neutral-950" />
    </div>
  );
}

function EmptyCanvas({ isPlanning }: { isPlanning?: boolean }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      {isPlanning ? (
        <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <Loader2 className="size-4 animate-spin text-neutral-700 dark:text-neutral-200" />
          Manager is decomposing the task into workflow nodes...
        </div>
      ) : (
        <div className="animate-in fade-in zoom-in-95 space-y-2 duration-500">
          <div className="mx-auto grid size-11 place-items-center rounded-lg border border-neutral-300 bg-white/80 dark:border-neutral-700 dark:bg-neutral-900/80">
            <GitBranch className="size-5 text-neutral-700 dark:text-neutral-200" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No workflow constructed yet — submit a task to begin.</p>
        </div>
      )}
    </div>
  );
}

type Viewport = { x: number; y: number; scale: number };

export function WorkflowPanel({ subtasks, isPlanning }: { subtasks: SubtaskRecord[]; isPlanning?: boolean }) {
  const graph = useMemo(() => buildGraph(subtasks), [subtasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 0.85 });
  const [smooth, setSmooth] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ active: boolean; startX: number; startY: number; originX: number; originY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const dragState = useRef<{ id: string; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ startDist: number; startScale: number; startMidX: number; startMidY: number; anchorX: number; anchorY: number } | null>(null);
  const prevCount = useRef(0);
  const zoomByRef = useRef<(factor: number, center?: { x: number; y: number }) => void>(() => {});

  function fitView() {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = Math.min(1, Math.max(MIN_SCALE, Math.min(rect.width / (graph.width + 80), rect.height / (graph.height + 80))));
    setViewport({
      x: (rect.width - graph.width * scale) / 2,
      y: (rect.height - graph.height * scale) / 2,
      scale,
    });
  }

  useEffect(() => {
    if (subtasks.length > 0 && prevCount.current === 0) {
      setOffsets({});
      requestAnimationFrame(fitView);
    }
    prevCount.current = subtasks.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtasks.length]);

  useEffect(() => {
    requestAnimationFrame(fitView);
    window.addEventListener("resize", fitView);
    return () => window.removeEventListener("resize", fitView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function positionOf(node: GraphNode) {
    const o = offsets[node.id];
    return { x: node.x + (o?.x ?? 0), y: node.y + (o?.y ?? 0) };
  }

  function zoomBy(factor: number, center?: { x: number; y: number }) {
    setViewport((v) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = center?.x ?? (rect ? rect.width / 2 : 0);
      const cy = center?.y ?? (rect ? rect.height / 2 : 0);
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return {
        scale: nextScale,
        x: cx - worldX * nextScale,
        y: cy - worldY * nextScale,
      };
    });
  }
  zoomByRef.current = zoomBy;

  // React attaches onWheel/onTouch* listeners as passive by default, so
  // calling preventDefault() inside a synthetic handler is a silent no-op —
  // the browser still runs its own native page-zoom alongside our canvas
  // zoom. A real, non-passive DOM listener is required to actually stop it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      setSmooth(false);
      const rect = el!.getBoundingClientRect();
      zoomByRef.current(e.deltaY < 0 ? 1.08 : 0.92, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [subtasks.length > 0]);

  function handleCanvasPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "touch") {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size === 2) {
        panState.current.active = false;
        setSmooth(false);
        const pts = Array.from(activePointers.current.values());
        const rect = containerRef.current?.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const midY = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);
        pinchState.current = {
          startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          startScale: viewport.scale,
          startMidX: midX,
          startMidY: midY,
          anchorX: (midX - viewport.x) / viewport.scale,
          anchorY: (midY - viewport.y) / viewport.scale,
        };
      }
      return;
    }
    if (e.button !== 0) return;
    setSmooth(false);
    panState.current = { active: true, startX: e.clientX, startY: e.clientY, originX: viewport.x, originY: viewport.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function smoothZoomBy(factor: number) {
    setSmooth(true);
    zoomBy(factor);
  }

  function smoothFitView() {
    setSmooth(true);
    fitView();
  }

  function handleCanvasPointerMove(e: ReactPointerEvent) {
    if (e.pointerType === "touch" && activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchState.current && activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const rect = containerRef.current?.getBoundingClientRect();
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
      const midY = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);
      const { startDist, startScale, anchorX, anchorY } = pinchState.current;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * (dist / startDist)));
      setViewport({ scale: nextScale, x: midX - anchorX * nextScale, y: midY - anchorY * nextScale });
      return;
    }
    if (dragState.current) {
      const { id, startX, startY, baseX, baseY } = dragState.current;
      const dx = (e.clientX - startX) / viewport.scale;
      const dy = (e.clientY - startY) / viewport.scale;
      setOffsets((prev) => ({ ...prev, [id]: { x: baseX + dx, y: baseY + dy } }));
      return;
    }
    if (!panState.current.active) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setViewport((v) => ({ ...v, x: panState.current.originX + dx, y: panState.current.originY + dy }));
  }

  function endInteractions(e: ReactPointerEvent) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchState.current = null;
    }
    panState.current.active = false;
    dragState.current = null;
  }

  function handleNodeDragStart(node: GraphNode, e: ReactPointerEvent) {
    e.stopPropagation();
    setSmooth(false);
    const o = offsets[node.id];
    dragState.current = { id: node.id, startX: e.clientX, startY: e.clientY, baseX: o?.x ?? 0, baseY: o?.y ?? 0 };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes.find((node) => node.kind === "task") ?? graph.nodes[0];
  const runningCount = subtasks.filter((subtask) => ACTIVE_STATUSES.has(subtask.status)).length;
  const doneCount = subtasks.filter((subtask) => subtask.status === "DONE").length;

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--canvas-grid)_1px,transparent_0)] bg-size-[22px_22px]" />

      {subtasks.length === 0 ? (
        <EmptyCanvas isPlanning={isPlanning} />
      ) : (
        <div
          ref={containerRef}
          className="relative h-full w-full touch-none"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={endInteractions}
          onPointerLeave={endInteractions}
          onPointerCancel={endInteractions}
        >
          <div
            className={cn("absolute left-0 top-0 origin-top-left", smooth && "transition-transform duration-300 ease-out")}
            style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`, width: graph.width, height: graph.height }}
          >
            <svg className="absolute inset-0 overflow-visible" width={graph.width} height={graph.height} role="img" aria-label="Workflow node connections">
              <defs>
                <marker id="workflow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-neutral-400 dark:fill-neutral-300" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const tone = statusTone(edge.to.status);
                const fromPos = positionOf(edge.from);
                const toPos = positionOf(edge.to);
                const point = centerPoint(fromPos, toPos);
                return (
                  <g key={edge.id}>
                    <path
                      d={connectorPath(fromPos, toPos)}
                      className={cn(edge.active ? tone.edge : "stroke-neutral-400/60 dark:stroke-neutral-600/55", edge.active && "drop-shadow-[0_0_4px_rgba(125,211,252,0.55)]")}
                      fill="none"
                      markerEnd="url(#workflow-arrow)"
                      strokeLinecap="round"
                      strokeWidth={edge.active ? 2.6 : 1.7}
                      strokeDasharray={edge.dashed ? "5 7" : undefined}
                    />
                    {edge.label && (
                      <text x={point.x} y={point.y - 8} textAnchor="middle" className="fill-neutral-500 text-[10px] uppercase tracking-normal dark:fill-neutral-400">
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {graph.nodes.map((node) => (
              <WorkflowNode
                key={node.id}
                node={node}
                pos={positionOf(node)}
                selected={selectedNode?.id === node.id}
                onSelect={(n) => setSelectedId(n.id)}
                onDragStart={handleNodeDragStart}
              />
            ))}
          </div>
        </div>
      )}

      {/* Workflow status chip */}
      <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2">
        <Badge variant="outline" className="gap-1 rounded-md border-panel-border bg-panel text-[10px] text-panel-muted shadow-lg backdrop-blur-xl">
          <GitBranch className="size-3" />
          Workflow Graph
        </Badge>
        {subtasks.length > 0 && (
          <Badge
            variant={runningCount > 0 ? "secondary" : "outline"}
            className="gap-1 rounded-md border-panel-border bg-panel text-[10px] text-panel-foreground shadow-lg backdrop-blur-xl"
          >
            {runningCount > 0 && <Loader2 className="size-3 animate-spin" />}
            {doneCount}/{subtasks.length} done
          </Badge>
        )}
      </div>

      {/*
        Bottom-right control stack: zoom controls + selected node detail live in one
        flex-col-reverse container anchored to a single safe corner. Stacking order
        (detail card above the zoom row) falls out of flex layout automatically, so
        nothing here depends on hand-tuned pixel offsets that break at odd viewport
        sizes — it can never collide with the header, side panels, or chat bar.
      */}
      <div className="pointer-events-none absolute bottom-36 right-3 z-30 flex max-h-[calc(100%-6.5rem)] max-w-[calc(100vw-1.5rem)] flex-col-reverse items-end gap-2 sm:bottom-4 sm:right-4 sm:max-h-[calc(100%-6rem)]">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-panel-border bg-panel p-1 shadow-lg backdrop-blur-xl transition-colors">
          <Button variant="ghost" size="icon" className="size-7 text-panel-muted hover:text-panel-foreground" onClick={() => smoothZoomBy(0.85)}>
            <Minus className="size-3.5" />
          </Button>
          <span className="w-10 text-center text-[11px] font-mono text-panel-muted">{Math.round(viewport.scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="size-7 text-panel-muted hover:text-panel-foreground" onClick={() => smoothZoomBy(1.15)}>
            <Plus className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-panel-muted hover:text-panel-foreground" onClick={smoothFitView}>
            <Maximize className="size-3.5" />
          </Button>
        </div>

        {subtasks.length > 0 && selectedNode && selectedNode.subtask && (
          <div className="pointer-events-auto animate-in fade-in slide-in-from-bottom-1 w-72 max-w-full overflow-hidden rounded-md border border-panel-border bg-panel p-3 text-panel-foreground shadow-xl backdrop-blur-xl duration-300">
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-panel-muted">{selectedNode.eyebrow}</span>
              <span className="truncate text-sm font-semibold">{selectedNode.title}</span>
              <Badge variant="outline" className={cn("ml-auto shrink-0 text-[10px] ring-1", statusTone(selectedNode.status).chip)}>
                {selectedNode.status}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="col-span-2 truncate">
                <span className="text-panel-muted">Capability </span>
                <span>{selectedNode.subtask?.requiredCapability ?? selectedNode.detail}</span>
              </div>
              <div className="truncate">
                <span className="text-panel-muted">Agent </span>
                <span>{selectedNode.subtask?.assignedAgent?.name ?? "Pending"}</span>
              </div>
              <div className="truncate">
                <span className="text-panel-muted">QA </span>
                <span>{selectedNode.subtask?.qaScore != null ? `${selectedNode.subtask.qaScore}/100` : "Not scored"}</span>
              </div>
              <div className="col-span-2 inline-flex items-center gap-1">
                <span className="text-panel-muted">Attempts </span>
                {selectedNode.subtask && selectedNode.subtask.attemptCount > 1 && <RotateCcw className="size-3 text-amber-500 dark:text-amber-200" />}
                {selectedNode.subtask ? `${selectedNode.subtask.attemptCount}/${selectedNode.subtask.maxAttempts}` : "1/1"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
