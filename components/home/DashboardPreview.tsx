"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  History,
  MessageSquare,
  Minus,
  Moon,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  Wallet,
  X,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   Interactive, fully-coded replica of the Kraven console.
   Designed on a fixed 1000×480 stage that is scaled to fit its container, so
   the layout is pixel-stable at every viewport width.
   ──────────────────────────────────────────────────────────────────────────── */

const STAGE_W = 1040;
const STAGE_H = 540;
const NW = 132; // node width
const NH = 58; // node height
const NH_QA = 34; // compact QA chip height
const Y0 = 64; // canvas vertical offset (below the toolbar)

type Kind = "trigger" | "step" | "qa" | "worker" | "data" | "response";
type Status = "idle" | "active" | "done" | "blocked";
type Side = "l" | "r" | "t" | "b";

type NodeDef = {
  id: string;
  kind: Kind;
  tag: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  rep?: number;
  price?: number;
  latency?: string;
  success?: string;
};

const NODES: NodeDef[] = [
  { id: "trigger", kind: "trigger", tag: "Start", label: "Task prompt", sub: "", x: 208, y: Y0 + 62 },
  { id: "qa1", kind: "qa", tag: "QA", label: "QA gate", sub: "95", x: 352, y: Y0, rep: 98, price: 1, latency: "3s", success: "99%" },
  { id: "step1", kind: "step", tag: "Step 1", label: "Data extraction", sub: "", x: 352, y: Y0 + 62 },
  { id: "atlas", kind: "worker", tag: "Researcher", label: "Atlas", sub: "Rep 91 · 3t", x: 352, y: Y0 + 170, rep: 91, price: 3, latency: "12s", success: "97%" },
  { id: "scraper", kind: "data", tag: "Tool", label: "Web scraper", sub: "2 sources", x: 352, y: Y0 + 270 },
  { id: "qa2", kind: "qa", tag: "QA", label: "QA gate", sub: "95", x: 520, y: Y0, rep: 98, price: 1, latency: "3s", success: "99%" },
  { id: "step2", kind: "step", tag: "Step 2", label: "Writing", sub: "", x: 520, y: Y0 + 62 },
  { id: "writer", kind: "worker", tag: "Writer", label: "Nova", sub: "Rep 97 · 3t", x: 520, y: Y0 + 170, rep: 97, price: 3, latency: "9s", success: "98%" },
  { id: "qa3", kind: "qa", tag: "QA", label: "QA gate", sub: "95", x: 688, y: Y0, rep: 98, price: 1, latency: "3s", success: "99%" },
  { id: "step3", kind: "step", tag: "Step 3", label: "Verification", sub: "", x: 688, y: Y0 + 62 },
  { id: "sentinel", kind: "worker", tag: "QA agent", label: "Guardian", sub: "Rep 97 · 5t", x: 688, y: Y0 + 170, rep: 97, price: 5, latency: "6s", success: "99%" },
  { id: "response", kind: "response", tag: "Output", label: "Final report", sub: "Verified", x: 688, y: Y0 + 270 },
];
const NODE_BY_ID: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));

function dims(n: NodeDef) {
  if (n.kind === "qa") return { w: NW, h: NH_QA };
  if (n.kind === "trigger") return { w: 104, h: NH };
  return { w: NW, h: NH };
}

type EdgeDef = { from: string; to: string; fs: Side; ts: Side; label?: string };
const EDGES: EdgeDef[] = [
  { from: "trigger", to: "step1", fs: "r", ts: "l", label: "PLAN" },
  { from: "step1", to: "step2", fs: "r", ts: "l" },
  { from: "step2", to: "step3", fs: "r", ts: "l" },
    { from: "step1", to: "qa1", fs: "t", ts: "b", label: "QA" },
  { from: "step2", to: "qa2", fs: "t", ts: "b", label: "QA" },
  { from: "step3", to: "qa3", fs: "t", ts: "b", label: "QA" },
  { from: "step1", to: "atlas", fs: "b", ts: "t", label: "HIRE" },
  { from: "step2", to: "writer", fs: "b", ts: "t", label: "HIRE" },
  { from: "step3", to: "sentinel", fs: "b", ts: "t", label: "HIRE" },
  { from: "atlas", to: "scraper", fs: "b", ts: "t", label: "SCRAPE" },
  { from: "sentinel", to: "response", fs: "b", ts: "t", label: "DELIVER" },
];

/* The simulated run: each phase = escrow lock → work → QA → payout. */
const PHASES = [
  { step: "step1", worker: "atlas", extra: "scraper", qa: "qa1", cost: 3, who: "atlas-01", out: "Fintech market map (3 segments)" },
  { step: "step2", worker: "writer", extra: null, qa: "qa2", cost: 3, who: "writer-01", out: "Investment memo draft" },
  { step: "step3", worker: "sentinel", extra: null, qa: "qa3", cost: 5, who: "qa-01", out: "Verified final report" },
] as const;

type EventTone = "plain" | "ok" | "bad";
type LogEvent = { id: number; src: string; time: string; text: string; tone: EventTone };
type Tx = { id: number; type: string; amt: string; status: "APPROVED" | "BLOCKED" };

const MARKET_AGENTS = [
  { name: "Atlas", role: "market_research", price: 3, rep: 91, score: 0.93 },
  { name: "Nova", role: "report_writing", price: 3, rep: 97, score: 0.91 },
  { name: "Guardian", role: "quality_assurance", price: 5, rep: 97, score: 0.9 },
  { name: "Orion Analyst", role: "financial_analysis", price: 4, rep: 88, score: 0.84 },
  { name: "Rogue Analyst", role: "financial_analysis", price: 2, rep: 18, score: 0.31 },
];

const DEFAULT_PROMPT =
  "Analyze the fintech startup market, identify promising segments, estimate key financial metrics, and produce an investment-style report.";

function stamp() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function anchor(n: NodeDef, pos: { x: number; y: number }, side: Side) {
  const { w, h } = dims(n);
  switch (side) {
    case "l": return { x: pos.x, y: pos.y + h / 2, dx: -1, dy: 0 };
    case "r": return { x: pos.x + w, y: pos.y + h / 2, dx: 1, dy: 0 };
    case "t": return { x: pos.x + w / 2, y: pos.y, dx: 0, dy: -1 };
    default: return { x: pos.x + w / 2, y: pos.y + h, dx: 0, dy: 1 };
  }
}

const THEMES = {
  light: {
    "--pv-bg": "#fafafa", "--pv-dot": "#d4d4d4", "--pv-panel": "#ffffff", "--pv-fg": "#171717",
    "--pv-mute": "#737373", "--pv-bd": "#e5e5e5", "--pv-sub": "#f5f5f5", "--pv-edge": "#a3a3a3",
    "--pv-gbg": "#ecfdf5", "--pv-gbd": "#6ee7b7", "--pv-gfg": "#047857",
    "--pv-rbg": "#fef2f2", "--pv-rbd": "#fca5a5", "--pv-rfg": "#b91c1c",
    "--pv-ink": "#171717", "--pv-inkfg": "#ffffff",
  },
  dark: {
    "--pv-bg": "#0b0d10", "--pv-dot": "#2a2f36", "--pv-panel": "#14171b", "--pv-fg": "#e5e7eb",
    "--pv-mute": "#8b949e", "--pv-bd": "#262b32", "--pv-sub": "#1b1f25", "--pv-edge": "#4b5563",
    "--pv-gbg": "rgba(16,185,129,0.12)", "--pv-gbd": "rgba(52,211,153,0.5)", "--pv-gfg": "#34d399",
    "--pv-rbg": "rgba(239,68,68,0.12)", "--pv-rbd": "rgba(248,113,113,0.5)", "--pv-rfg": "#f87171",
    "--pv-ink": "#e5e7eb", "--pv-inkfg": "#0b0d10",
  },
} as const;

const NODE_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  trigger: Play,
  step: Sparkles,
  qa: ShieldCheck,
  worker: Bot,
  data: Globe,
  response: MessageSquare,
};

export function DashboardPreview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [width, setWidth] = useState(0);
  const [tab, setTab] = useState<"flow" | "activity" | "economy">("flow");
  const [dark, setDark] = useState(false);

  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(NODES.map((n) => [n.id, { x: n.x, y: n.y }])),
  );
  const [status, setStatus] = useState<Record<string, Status>>(() =>
    Object.fromEntries(NODES.map((n) => [n.id, "done" as Status])),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [modal, setModal] = useState<null | "report" | "history" | "marketplace">(null);

  const [mode, setMode] = useState<"demo" | "custom">("demo");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [budget, setBudget] = useState(30);
  const [quality, setQuality] = useState(70);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(true);

  const [released, setReleased] = useState(11);
  const [escrow, setEscrow] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [rogue, setRogue] = useState(false);

  const idRef = useRef(100);
  const nextId = () => ++idRef.current;
  const timers = useRef<number[]>([]);

  const [events, setEvents] = useState<LogEvent[]>([
    { id: 1, src: "system", time: "11:35:39 AM", text: "Workflow stored for future reuse", tone: "plain" },
    { id: 2, src: "manager", time: "11:35:39 AM", text: "Task completed", tone: "ok" },
    { id: 3, src: "circuit_breaker", time: "11:35:34 AM", text: "Payment approved: 5 tokens to qa-01", tone: "ok" },
    { id: 4, src: "qa-01", time: "11:35:34 AM", text: "qa-01 requested payout of 5 tokens", tone: "plain" },
    { id: 5, src: "qa", time: "11:35:34 AM", text: "QA passed - score 95/100", tone: "ok" },
    { id: 6, src: "qa", time: "11:35:34 AM", text: "WORKFLOW_ANCHORED", tone: "plain" },
    { id: 7, src: "system", time: "11:35:29 AM", text: "Reputation updated for qa-01: 98", tone: "plain" },
  ]);
  const [txs, setTxs] = useState<Tx[]>([
    { id: 1, type: "PAYOUT", amt: "5t", status: "APPROVED" },
    { id: 2, type: "LOCK", amt: "5t", status: "APPROVED" },
    { id: 3, type: "PAYOUT", amt: "3t", status: "APPROVED" },
    { id: 4, type: "LOCK", amt: "3t", status: "APPROVED" },
    { id: 5, type: "PAYOUT", amt: "3t", status: "APPROVED" },
    { id: 6, type: "LOCK", amt: "3t", status: "APPROVED" },
  ]);

  const remaining = budget - released - escrow;

  /* fit stage to container */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setScale(el.clientWidth / STAGE_W);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const log = useCallback((src: string, text: string, tone: EventTone = "plain") => {
    setEvents((e) => [{ id: nextId(), src, time: stamp(), text, tone }, ...e].slice(0, 24));
  }, []);
  const pushTx = useCallback((type: string, amt: string, st: Tx["status"]) => {
    setTxs((t) => [{ id: nextId(), type, amt, status: st }, ...t].slice(0, 6));
  }, []);
  const set = (ids: string[], s: Status) =>
    setStatus((cur) => ({ ...cur, ...Object.fromEntries(ids.map((i) => [i, s])) }));

  function after(ms: number, fn: () => void) {
    timers.current.push(window.setTimeout(fn, ms));
  }

  function run(optimized: boolean) {
    if (running) return;
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    const total = PHASES.reduce((a, p) => a + p.cost, 0);
    const b = Math.max(total, budget);
    if (b !== budget) setBudget(b);

    setRunning(true);
    setHasRun(false);
    setRogue(false);
    setReleased(0);
    setEscrow(0);
    setBlocked(0);
    setSelected(null);
    setStatus(Object.fromEntries(NODES.map((n) => [n.id, "idle" as Status])));
    setEvents([]);
    setTxs([]);

    let t = 0;
    after(t, () => {
      set(["trigger"], "active");
      log("manager", optimized ? "Prompt optimized - task received" : "Optimization skipped - task received");
    });
    t += 700;
    after(t, () => {
      set(["trigger"], "done");
      log("system", "Discovery: 1240 agents → 312 → 87 → 24 → 11 candidates");
    });

    PHASES.forEach((p) => {
      t += 700;
      after(t, () => {
        set([p.step], "active");
        setEscrow((e) => e + p.cost);
        pushTx("LOCK", `${p.cost}t`, "APPROVED");
        log("escrow", `Locked ${p.cost} tokens for ${p.who}`);
      });
      t += 600;
      after(t, () => {
        set([p.worker, ...(p.extra ? [p.extra] : [])], "active");
        log(p.who, `${p.who} started: ${p.out}`);
      });
      t += 1500;
      after(t, () => {
        set([p.worker, ...(p.extra ? [p.extra] : [])], "done");
        set([p.qa], "active");
        log(p.who, `${p.who} completed work`);
        log("qa", "QA reviewing output...");
      });
      t += 900;
      after(t, () => {
        set([p.qa, p.step], "done");
        log("qa", "QA passed - score 95/100", "ok");
        log(p.who, `${p.who} requested payout of ${p.cost} tokens`);
      });
      t += 500;
      after(t, () => {
        setEscrow((e) => e - p.cost);
        setReleased((r) => r + p.cost);
        pushTx("PAYOUT", `${p.cost}t`, "APPROVED");
        log("circuit_breaker", `Payment approved: ${p.cost} tokens to ${p.who}`, "ok");
      });
    });

    t += 600;
    after(t, () => {
      set(["response"], "done");
      log("system", "Workflow stored for future reuse");
      log("manager", "Task completed", "ok");
      setRunning(false);
      setHasRun(true);
    });
  }

  function fireRogue() {
    if (running) return;
    setRogue(true);
    setBlocked((n) => n + 1);
    set(["atlas"], "blocked");
    log("atlas-01", "atlas-01 requested 10,000 tokens (authorized: 8)", "bad");
    log("circuit_breaker", "BLOCKED - exceeds scoped credential. Ledger unchanged.", "bad");
    pushTx("TRANSFER", "10,000t", "BLOCKED");
    after(3200, () => set(["atlas"], "done"));
  }

  function reset() {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setRunning(false);
    setHasRun(true);
    setRogue(false);
    setBlocked(0);
    setReleased(11);
    setEscrow(0);
    setZoom(1);
    setSelected(null);
    setPos(Object.fromEntries(NODES.map((n) => [n.id, { x: n.x, y: n.y }])));
    setStatus(Object.fromEntries(NODES.map((n) => [n.id, "done" as Status])));
    setEvents([{ id: nextId(), src: "system", time: stamp(), text: "Console reset - ready for a new task", tone: "plain" }]);
    setTxs([]);
  }

  /* ── node dragging ── */
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: pos[id].x, oy: pos[id].y, moved: false };
  }
  function onNodeMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !scale) return;
    const k = scale * zoom;
    const dx = (e.clientX - d.sx) / k;
    const dy = (e.clientY - d.sy) / k;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    setPos((p) => ({
      ...p,
      [d.id]: {
        x: Math.min(STAGE_W - dims(NODE_BY_ID[d.id]).w, Math.max(0, d.ox + dx)),
        y: Math.min(STAGE_H - dims(NODE_BY_ID[d.id]).h, Math.max(0, d.oy + dy)),
      },
    }));
  }
  function onNodeUp(id: string) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setSelected((s) => (s === id ? null : id));
  }

  const activeIds = new Set(Object.entries(status).filter(([, s]) => s === "active").map(([id]) => id));
  const theme = THEMES[dark ? "dark" : "light"];
  const selNode = NODES.find((n) => n.id === selected);

  const modalEl = (big: boolean) =>
    modal && (
      <div
        className={`${big ? "fixed p-4" : "absolute"} inset-0 z-40 grid place-items-center bg-black/30 backdrop-blur-[2px]`}
        onClick={() => setModal(null)}
      >
        <div
          className={`${big ? "w-full max-w-sm" : "w-[460px]"} rounded-xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-4 text-[var(--pv-fg)] shadow-2xl`}
          style={theme as React.CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`${big ? "text-base" : "text-[14px]"} font-semibold capitalize`}>{modal}</h3>
            <button onClick={() => setModal(null)} aria-label="Close" className={big ? "p-1" : ""}>
              <X className={`${big ? "size-5" : "size-3.5"} text-[var(--pv-mute)]`} />
            </button>
          </div>

          {modal === "marketplace" && (
            <table className={`w-full ${big ? "text-xs" : "text-[11.5px]"}`}>
              <thead className={`text-left font-mono uppercase text-[var(--pv-mute)] ${big ? "text-[10px]" : "text-[10px]"}`}>
                <tr><th className="pb-1">Agent</th><th>Role</th><th>Price</th><th>Rep</th><th>Score</th></tr>
              </thead>
              <tbody>
                {MARKET_AGENTS.map((a) => (
                  <tr key={a.name} className="border-t border-[var(--pv-bd)]">
                    <td className="py-1.5 font-semibold">{a.name}</td>
                    <td className="text-[var(--pv-mute)]">{big ? a.role.split("_")[0] : a.role}</td>
                    <td className="font-mono">{a.price}t</td>
                    <td className={`font-mono ${a.rep < 40 ? "text-[var(--pv-rfg)]" : ""}`}>{a.rep}</td>
                    <td className="font-mono">{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {modal === "history" && (
            <ul className={`space-y-1.5 ${big ? "text-sm" : "text-[11.5px]"}`}>
              {[
                ["Fintech market analysis", "95/100", "11t"],
                ["Competitor teardown", "91/100", "9t"],
                ["Pricing study", "88/100", "7t"],
              ].map(([n, q, c]) => (
                <li key={n} className="flex items-center justify-between gap-2 rounded border border-[var(--pv-bd)] bg-[var(--pv-sub)] px-2 py-1.5">
                  <span className="font-medium">{n}</span>
                  <span className="shrink-0 font-mono text-[var(--pv-mute)]">{q} · {c}</span>
                </li>
              ))}
            </ul>
          )}

          {modal === "report" && (
            <div className={`space-y-2 leading-relaxed ${big ? "text-sm" : "text-[11.5px]"}`}>
              {hasRun ? (
                <>
                  <p><b>Executive summary.</b> Three fintech segments show durable growth: embedded payments, SME lending, and wealth-tech.</p>
                  <p><b>Workforce.</b> Atlas → Writer → QA Sentinel. Cost <span className="font-mono">{released}t</span> of <span className="font-mono">{budget}t</span>, QA 95/100.</p>
                  <p className="text-[var(--pv-mute)]">Assembled from worker outputs. Illustrative preview data.</p>
                </>
              ) : (
                <p className="text-[var(--pv-mute)]">The report is assembled once every step passes QA - run in progress.</p>
              )}
            </div>
          )}
        </div>
      </div>
    );

  const compact = width > 0 && width < 900;

  /* ── mobile helpers ── */
  const nodeById = (id: string) => NODES.find((n) => n.id === id)!;
  const stCls = (s: Status) =>
    s === "blocked"
      ? "border-[var(--pv-rbd)] bg-[var(--pv-rbg)] text-[var(--pv-rfg)]"
      : s === "active"
        ? "border-emerald-500 bg-[var(--pv-gbg)] text-[var(--pv-gfg)]"
        : s === "done"
          ? "border-[var(--pv-gbd)] bg-[var(--pv-gbg)] text-[var(--pv-gfg)]"
          : "border-[var(--pv-bd)] bg-[var(--pv-panel)] text-[var(--pv-mute)]";
  const chip = (id: string) => {
    const n = nodeById(id);
    const Icon = NODE_ICON[n.kind];
    return (
      <button
        key={id}
        onClick={() => setSelected((s) => (s === id ? null : id))}
        className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${stCls(status[id])} ${selected === id ? "ring-2 ring-[var(--pv-ink)]/40" : ""} ${status[id] === "active" ? "animate-pulse" : ""}`}
      >
        <Icon className="size-3.5" />
        {n.label}
      </button>
    );
  };
  const connector = (on: boolean) => (
    <div className="flex justify-center">
      <div className={`h-4 w-px ${on ? "bg-emerald-500" : "bg-[var(--pv-edge)]"}`} />
    </div>
  );
  const latest = events[0];

  const mobileView = (
    <div className="space-y-3 p-3 text-[var(--pv-fg)]" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
      {/* toolbar */}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]">
        {[
          { k: "report", icon: FileText, label: "Report" },
          { k: "history", icon: History, label: "History" },
          { k: "marketplace", icon: Store, label: "Market" },
        ].map(({ k, icon: I, label }) => (
          <button
            key={k}
            onClick={() => setModal(k as "report")}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] px-3 text-sm font-medium"
          >
            <I className="size-4" /> {label}
          </button>
        ))}
        <button
          onClick={fireRogue}
          disabled={running}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--pv-rbd)] bg-[var(--pv-rbg)] px-3 text-sm font-medium text-[var(--pv-rfg)] disabled:opacity-40"
        >
          <ShieldAlert className="size-4" /> Rogue demo
        </button>
        <button
          onClick={reset}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] px-3 text-sm font-medium"
        >
          <RotateCcw className="size-4" /> Reset
        </button>
        <button
          onClick={() => setDark((d) => !d)}
          aria-label="Toggle preview theme"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)]"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      {/* live ticker (visible from every tab) */}
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          rogue ? "border-[var(--pv-rbd)] bg-[var(--pv-rbg)] text-[var(--pv-rfg)]" : "border-[var(--pv-bd)] bg-[var(--pv-panel)]"
        }`}
      >
        {rogue ? (
          <ShieldAlert className="size-4 shrink-0" />
        ) : (
          <span className={`size-2 shrink-0 rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-[var(--pv-mute)]"}`} />
        )}
        <span className="truncate">
          {rogue ? "Circuit breaker blocked a 10,000-token transfer" : latest ? latest.text : "Ready"}
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs text-[var(--pv-mute)]">
          {released}/{budget}t
        </span>
      </div>

      {/* tabs */}
      <div className="grid grid-cols-3 rounded-lg bg-[var(--pv-sub)] p-1 text-sm font-medium">
        {(
          [
            ["flow", "Workflow"],
            ["activity", "Activity"],
            ["economy", "Economy"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`h-9 rounded-md ${tab === k ? "bg-[var(--pv-panel)] shadow-sm" : "text-[var(--pv-mute)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "flow" && (
        <div>
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ${stCls(status.trigger === "done" ? "done" : status.trigger)}`}>
            <Play className="size-4" /> Task Trigger
            <span className="ml-auto text-xs font-normal opacity-80">Manager receives prompt</span>
          </div>
          {PHASES.map((p, i) => {
            const stepNode = nodeById(p.step);
            return (
              <div key={p.step}>
                {connector(status[p.step] !== "idle")}
                <div className={`rounded-lg border p-3 ${stCls(status[p.step])}`}>
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-md bg-emerald-500 text-xs font-bold text-white">{i + 1}</span>
                    <span className="text-sm font-semibold capitalize text-[var(--pv-fg)]">{stepNode.label}</span>
                    {status[p.step] === "done" && <CheckCircle2 className="ml-auto size-4 text-emerald-500" />}
                    {status[p.step] === "active" && <span className="ml-auto text-xs font-medium">running…</span>}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {chip(p.worker)}
                    {p.extra && chip(p.extra)}
                    {chip(p.qa)}
                  </div>
                </div>
              </div>
            );
          })}
          {connector(status.response === "done")}
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ${stCls(status.response)}`}>
            <MessageSquare className="size-4" /> Final Output
            <span className="ml-auto text-xs font-normal opacity-80">Verified result</span>
          </div>

          {selected && (
            <div className="mt-3 rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{nodeById(selected).label}</span>
                <button onClick={() => setSelected(null)} aria-label="Close" className="p-1">
                  <X className="size-4 text-[var(--pv-mute)]" />
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-y-1.5 text-xs">
                {[
                  ["Status", status[selected]],
                  ["Reputation", nodeById(selected).rep ?? "-"],
                  ["Price", nodeById(selected).price ? `${nodeById(selected).price} tokens` : "-"],
                  ["Latency", nodeById(selected).latency ?? "-"],
                  ["Success", nodeById(selected).success ?? "-"],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-[var(--pv-mute)]">{k}</dt>
                    <dd className="font-mono font-medium capitalize">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-1.5">
          {events.length === 0 && <p className="py-6 text-center text-sm text-[var(--pv-mute)]">No events yet</p>}
          {events.slice(0, 10).map((ev) => (
            <div
              key={ev.id}
              className={`rounded-lg border px-3 py-2 ${
                ev.tone === "ok"
                  ? "border-[var(--pv-gbd)] bg-[var(--pv-gbg)] text-[var(--pv-gfg)]"
                  : ev.tone === "bad"
                    ? "border-[var(--pv-rbd)] bg-[var(--pv-rbg)] text-[var(--pv-rfg)]"
                    : "border-[var(--pv-bd)] bg-[var(--pv-sub)]"
              }`}
            >
              <div className="flex gap-2 font-mono text-[11px] opacity-70">
                <span>{ev.src}</span>
                <span>{ev.time}</span>
              </div>
              <div className="mt-0.5 text-sm leading-snug">{ev.text}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "economy" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Budget", budget, ""],
              ["Remaining", remaining, ""],
              ["Escrow", escrow, ""],
              ["Released", released, "text-emerald-500"],
              ["Refunded", 0, ""],
              ["Blocked", blocked, blocked ? "text-[var(--pv-rfg)]" : ""],
            ].map(([k, v, c]) => (
              <div key={k as string} className="rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] px-3 py-2">
                <div className="text-xs text-[var(--pv-mute)]">{k}</div>
                <div className={`font-mono text-xl font-semibold tabular-nums ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          <div
            className={`rounded-lg border px-3 py-2.5 ${
              rogue ? "border-[var(--pv-rbd)] bg-[var(--pv-rbg)] text-[var(--pv-rfg)]" : "border-[var(--pv-gbd)] bg-[var(--pv-gbg)] text-[var(--pv-gfg)]"
            }`}
          >
            <div className="flex items-center gap-1.5 font-mono text-sm font-bold">
              {rogue ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
              {rogue ? "CIRCUIT BREAKER TRIGGERED" : "SYSTEM SECURE"}
            </div>
            <div className="mt-1 text-xs">
              {rogue
                ? "atlas-01 asked 10,000 · authorized 8 · BLOCKED · ledger unchanged"
                : `Authorized spend: ${released + escrow}t / ${budget}t`}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--pv-mute)]">
              <Wallet className="size-3.5" /> Recent transactions
            </div>
            {txs.length === 0 && <p className="text-sm text-[var(--pv-mute)]">None yet</p>}
            {txs.slice(0, 5).map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 font-mono text-xs ${
                  t.status === "BLOCKED" ? "bg-[var(--pv-rbg)] text-[var(--pv-rfg)]" : "bg-[var(--pv-sub)]"
                }`}
              >
                <span>{t.type}</span>
                <span>{t.amt}</span>
                <span className="font-semibold">{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* prompt */}
      <div className="rounded-xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-3 shadow-sm">
        <textarea
          value={prompt}
          readOnly={mode === "demo"}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="w-full resize-none bg-transparent text-base leading-snug outline-none sm:text-sm"
          aria-label="Task prompt"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-[var(--pv-sub)] p-0.5 text-sm font-medium">
            {(["demo", "custom"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  if (m === "demo") setPrompt(DEFAULT_PROMPT);
                }}
                className={`h-8 rounded-full px-3 capitalize ${mode === m ? "bg-[var(--pv-ink)] text-[var(--pv-inkfg)]" : "text-[var(--pv-mute)]"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 rounded-md bg-[var(--pv-sub)] px-2 text-xs text-[var(--pv-mute)]">
            Budget
            <input
              type="number"
              min={11}
              max={500}
              value={budget}
              disabled={running}
              onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 w-10 bg-transparent font-mono text-sm font-semibold text-[var(--pv-fg)] outline-none"
            />
          </label>
          <label className="flex items-center gap-1 rounded-md bg-[var(--pv-sub)] px-2 text-xs text-[var(--pv-mute)]">
            Quality
            <input
              type="number"
              min={0}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              className="h-8 w-9 bg-transparent font-mono text-sm font-semibold text-[var(--pv-fg)] outline-none"
            />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-2">
          <button
            onClick={() => run(false)}
            disabled={running}
            className="h-11 rounded-lg border border-[var(--pv-bd)] px-3 text-sm text-[var(--pv-mute)] disabled:opacity-40"
          >
            Unoptimized
          </button>
          <button
            onClick={() => run(true)}
            disabled={running}
            className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--pv-ink)] text-sm font-semibold text-[var(--pv-inkfg)] disabled:opacity-60"
          >
            <Sparkles className="size-4" />
            {running ? "Running…" : "Optimize Prompt"}
          </button>
        </div>
      </div>
      {modalEl(true)}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none overflow-hidden"
      style={{
        ...(compact ? {} : { aspectRatio: `${STAGE_W} / ${STAGE_H}` }),
        background: "var(--pv-bg)",
        ...(theme as React.CSSProperties),
      }}
      aria-label="Interactive preview of the Kraven console"
    >
      <style>{`
        @keyframes pv-dash { to { stroke-dashoffset: -16; } }
        @keyframes pv-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,.45);} 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0);} }
        @keyframes pv-shake { 0%,100% { transform: translateX(0);} 25% { transform: translateX(-2px);} 75% { transform: translateX(2px);} }
      `}</style>

      {compact && mobileView}

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          display: compact ? "none" : undefined,
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale || 1})`,
          opacity: scale ? 1 : 0,
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          color: "var(--pv-fg)",
        }}
      >
        {/* dotted canvas */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(var(--pv-dot) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
          onPointerDown={() => setSelected(null)}
        />

        {/* ── graph layer (zoomable) ── */}
        <div
          className="absolute inset-0 origin-center"
          style={{ transform: `scale(${zoom})`, transition: "transform 200ms ease" }}
        >
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={STAGE_W} height={STAGE_H}>
            <defs>
              {[
                ["pv-ah-n", "var(--pv-edge)"],
                ["pv-ah-g", "#10b981"],
              ].map(([id, c]) => (
                <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M1,1 L7,4 L1,7" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              ))}
            </defs>
            {EDGES.map((e) => {
              const a = anchor(NODE_BY_ID[e.from], pos[e.from], e.fs);
              const b = anchor(NODE_BY_ID[e.to], pos[e.to], e.ts);
              const k = Math.max(24, Math.min(54, Math.hypot(b.x - a.x, b.y - a.y) / 2));
              const d = `M${a.x},${a.y} C${a.x + a.dx * k},${a.y + a.dy * k} ${b.x + b.dx * k},${b.y + b.dy * k} ${b.x},${b.y}`;
              const live = activeIds.has(e.from) || activeIds.has(e.to);
              const done = status[e.from] === "done" && status[e.to] === "done";
              const tool = e.label === "HIRE" || e.label === "SCRAPE";
              const green = live || done;
              return (
                <g key={`${e.from}-${e.to}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={green ? "#10b981" : "var(--pv-edge)"}
                    strokeWidth={live ? 1.75 : 1.25}
                    strokeDasharray={live ? "5 4" : tool ? "3 4" : undefined}
                    opacity={live ? 1 : done ? 0.7 : 0.55}
                    markerEnd={`url(#${green ? "pv-ah-g" : "pv-ah-n"})`}
                    style={live ? { animation: "pv-dash 0.6s linear infinite" } : undefined}
                  />
                  {e.label && live && (
                    <text
                      x={(a.x + b.x) / 2 + (a.dy !== 0 ? 10 : 0)}
                      y={(a.y + b.y) / 2 + (a.dy !== 0 ? 3 : -6)}
                      textAnchor={a.dy !== 0 ? "start" : "middle"}
                      fontSize="9.5"
                      letterSpacing="0.1em"
                      fill="var(--pv-gfg)"
                      style={{ paintOrder: "stroke", stroke: "var(--pv-bg)", strokeWidth: 4 }}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {NODES.map((n) => {
            const s = status[n.id];
            const Icon = NODE_ICON[n.kind];
            const { w, h } = dims(n);
            const isQa = n.kind === "qa";
            const tone =
              s === "blocked"
                ? "border-[var(--pv-rbd)] bg-[var(--pv-rbg)]"
                : s === "active"
                  ? "border-emerald-500 bg-[var(--pv-gbg)]"
                  : "border-[var(--pv-bd)] bg-[var(--pv-panel)]";
            const dot =
              s === "blocked"
                ? "bg-[var(--pv-rfg)]"
                : s === "active"
                  ? "animate-pulse bg-emerald-500"
                  : s === "done"
                    ? "bg-emerald-500"
                    : "border border-[var(--pv-edge)]";
            const iconTone =
              s === "blocked" ? "text-[var(--pv-rfg)]" : s === "idle" ? "text-[var(--pv-mute)]" : "text-[var(--pv-gfg)]";
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onNodeDown(e, n.id)}
                onPointerMove={onNodeMove}
                onPointerUp={() => onNodeUp(n.id)}
                className={`absolute flex cursor-grab touch-none items-center rounded-lg border shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[background,border-color,opacity] duration-300 active:cursor-grabbing ${tone} ${s === "idle" ? "opacity-60" : ""} ${selected === n.id ? "ring-2 ring-[var(--pv-ink)]/30" : ""}`}
                style={{
                  left: pos[n.id].x,
                  top: pos[n.id].y,
                  width: w,
                  height: h,
                  animation:
                    s === "active"
                      ? "pv-pulse 1.2s ease-out infinite"
                      : s === "blocked"
                        ? "pv-shake 0.3s ease-in-out 3"
                        : undefined,
                }}
              >
                {isQa ? (
                  <div className="flex w-full items-center gap-2 px-3">
                    <Icon className={`size-[14px] shrink-0 ${iconTone}`} />
                    <span className="whitespace-nowrap text-[11.5px] font-medium">{n.label}</span>
                    <span className="ml-auto font-mono text-[11.5px] font-semibold tabular-nums">{n.sub}</span>
                  </div>
                ) : (
                  <div className="w-full px-3">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`size-[12px] shrink-0 ${iconTone}`} />
                      <span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--pv-mute)]">{n.tag}</span>
                      <span className={`ml-auto size-[7px] shrink-0 rounded-full ${dot}`} />
                    </div>
                    <div className="mt-1 truncate text-[13px] font-semibold leading-tight">{n.label}</div>
                    {n.sub && <div className="mt-px truncate text-[10.5px] text-[var(--pv-mute)]">{n.sub}</div>}
                  </div>
                )}
              </div>
            );
          })}

          {/* agent detail card */}
          {selNode && (
            <div
              className="absolute z-20 w-[196px] rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-3 text-[11px] shadow-xl"
              style={{
                left: pos[selNode.id].x > 560 ? pos[selNode.id].x - 196 - 10 : pos[selNode.id].x + dims(selNode).w + 10,
                top: pos[selNode.id].y - 4,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">{selNode.label}</span>
                <button onClick={() => setSelected(null)} aria-label="Close">
                  <X className="size-4 text-[var(--pv-mute)]" />
                </button>
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--pv-mute)]">{selNode.tag}</div>
              <dl className="mt-2.5 space-y-1.5">
                {[
                  ["Status", status[selNode.id]],
                  ["Reputation", selNode.rep ?? "-"],
                  ["Price", selNode.price ? `${selNode.price} tokens` : "-"],
                  ["Latency", selNode.latency ?? "-"],
                  ["Success", selNode.success ?? "-"],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between border-t border-[var(--pv-bd)] pt-1.5">
                    <dt className="text-[var(--pv-mute)]">{k}</dt>
                    <dd className="font-mono font-medium capitalize">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* ── toolbar ── */}
        <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-1 text-[12px] shadow-sm">
          {[
            { k: "report", icon: FileText, label: "Report" },
            { k: "history", icon: History, label: "History" },
            { k: "marketplace", icon: Store, label: "Marketplace" },
          ].map(({ k, icon: I, label }) => (
            <button
              key={k}
              onClick={() => setModal(k as "report")}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium text-[var(--pv-fg)] transition-colors hover:bg-[var(--pv-sub)]"
            >
              <I className="size-[14px] text-[var(--pv-mute)]" /> {label}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-[var(--pv-bd)]" />
          <button
            onClick={fireRogue}
            disabled={running}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium text-[var(--pv-rfg)] transition-colors hover:bg-[var(--pv-rbg)] disabled:opacity-40"
          >
            <ShieldAlert className="size-[14px]" /> Fire Rogue Demo
          </button>
          <button
            onClick={reset}
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium transition-colors hover:bg-[var(--pv-sub)]"
          >
            <RotateCcw className="size-[14px] text-[var(--pv-mute)]" /> New chat
          </button>
          <span className="mx-0.5 h-4 w-px bg-[var(--pv-bd)]" />
          <button
            onClick={() => setDark((d) => !d)}
            aria-label="Toggle preview theme"
            className="grid size-7 place-items-center rounded-lg text-[var(--pv-mute)] transition-colors hover:bg-[var(--pv-sub)]"
          >
            {dark ? <Sun className="size-[14px]" /> : <Moon className="size-[14px]" />}
          </button>
          <div className="flex h-7 items-center gap-2 rounded-lg bg-[var(--pv-sub)] pl-1 pr-2.5">
            <span className="grid size-5 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-[9px] font-bold text-white">
              A
            </span>
            <span className="font-medium">Ayantik Sarkar</span>
          </div>
        </div>

        {/* ── live activity ── */}
        <aside
          className="absolute left-4 top-16 z-20 overflow-hidden rounded-xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] shadow-sm transition-[width,height] duration-200"
          style={{ width: leftOpen ? 184 : 132, height: leftOpen ? 460 : 40 }}
        >
          <button
            onClick={() => setLeftOpen((o) => !o)}
            className="flex h-10 w-full items-center justify-between px-3 text-[12px] font-semibold"
          >
            <span className="flex items-center gap-2">
              <span className={`size-[7px] rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-[var(--pv-edge)]"}`} />
              Live Activity
            </span>
            {leftOpen ? (
              <ChevronLeft className="size-4 text-[var(--pv-mute)]" />
            ) : (
              <ChevronRight className="size-4 text-[var(--pv-mute)]" />
            )}
          </button>
          <ol className="h-[calc(100%-40px)] overflow-hidden border-t border-[var(--pv-bd)] px-3 py-1">
            {events.length === 0 && <li className="py-6 text-center text-[11px] text-[var(--pv-mute)]">No events yet</li>}
            {events.slice(0, 6).map((ev) => (
              <li
                key={ev.id}
                className="animate-in fade-in slide-in-from-top-1 flex gap-2.5 border-b border-[var(--pv-bd)] py-2 duration-300 last:border-0"
              >
                <span
                  className={`mt-[5px] size-[6px] shrink-0 rounded-full ${
                    ev.tone === "ok" ? "bg-emerald-500" : ev.tone === "bad" ? "bg-[var(--pv-rfg)]" : "bg-[var(--pv-edge)]"
                  }`}
                />
                <div className="min-w-0">
                  <div
                    className={`text-[11.5px] leading-snug ${
                      ev.tone === "bad" ? "text-[var(--pv-rfg)]" : ev.tone === "ok" ? "text-[var(--pv-gfg)]" : ""
                    }`}
                  >
                    {ev.text}
                  </div>
                  <div className="mt-0.5 flex font-mono text-[9.5px] text-[var(--pv-mute)]">
                    <span className="truncate">{ev.src}</span>
                    <span className="shrink-0">&nbsp;· {ev.time.replace(/ [AP]M/, "")}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        {/* ── economy ── */}
        <aside
          className="absolute right-4 top-16 z-20 overflow-hidden rounded-xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] shadow-sm transition-[width,height] duration-200"
          style={{ width: rightOpen ? 184 : 124, height: rightOpen ? 460 : 40 }}
        >
          <button
            onClick={() => setRightOpen((o) => !o)}
            className="flex h-10 w-full items-center justify-between px-3 text-[12px] font-semibold"
          >
            <span className="flex items-center gap-2">
              <Wallet className="size-[14px] text-[var(--pv-mute)]" /> Economy
            </span>
            {rightOpen ? (
              <ChevronRight className="size-4 text-[var(--pv-mute)]" />
            ) : (
              <ChevronLeft className="size-4 text-[var(--pv-mute)]" />
            )}
          </button>
          <div className="border-t border-[var(--pv-bd)]">
            <div className="grid grid-cols-2">
              {[
                ["Budget", budget, ""],
                ["Remaining", remaining, ""],
                ["In escrow", escrow, ""],
                ["Released", released, "text-[var(--pv-gfg)]"],
                ["Refunded", 0, ""],
                ["Blocked", blocked, blocked ? "text-[var(--pv-rfg)]" : ""],
              ].map(([k, v, c], i) => (
                <div
                  key={k as string}
                  className={`px-3 py-2 ${i % 2 === 0 ? "border-r border-[var(--pv-bd)]" : ""} ${i > 1 ? "border-t border-[var(--pv-bd)]" : ""}`}
                >
                  <div className="text-[10px] text-[var(--pv-mute)]">{k}</div>
                  <div className={`font-mono text-[19px] font-semibold leading-tight tabular-nums ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-[var(--pv-bd)] p-3">
              <div
                className={`rounded-lg px-2.5 py-2 transition-colors ${
                  rogue ? "bg-[var(--pv-rbg)] text-[var(--pv-rfg)]" : "bg-[var(--pv-gbg)] text-[var(--pv-gfg)]"
                }`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  {rogue ? <ShieldAlert className="size-[14px]" /> : <ShieldCheck className="size-[14px]" />}
                  {rogue ? "Breaker tripped" : "System secure"}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-snug opacity-90">
                  {rogue
                    ? "10,000 requested, 8 authorized. Ledger unchanged."
                    : `Authorized spend ${released + escrow}t of ${budget}t`}
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--pv-bd)] px-3 pb-2 pt-2.5">
              <div className="mb-1 text-[10px] text-[var(--pv-mute)]">Recent transactions</div>
              {txs.length === 0 && <div className="py-2 text-[10.5px] text-[var(--pv-mute)]">None yet</div>}
              {txs.slice(0, rogue ? 4 : 5).map((t) => (
                <div
                  key={t.id}
                  className="animate-in fade-in grid grid-cols-[1fr_auto_auto] items-center gap-2 py-[5px] font-mono text-[10.5px] duration-300"
                >
                  <span>{t.type}</span>
                  <span className="text-right tabular-nums text-[var(--pv-mute)]">{t.amt}</span>
                  <span
                    className={`w-[18px] text-right text-[12px] leading-none ${
                      t.status === "BLOCKED" ? "text-[var(--pv-rfg)]" : "text-[var(--pv-gfg)]"
                    }`}
                    title={t.status}
                  >
                    {t.status === "BLOCKED" ? "✕" : "✓"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── zoom controls ── */}
        <div className="absolute left-[212px] top-[64px] z-20 flex items-center rounded-lg border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-0.5 font-mono text-[11px] shadow-sm">
          <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} className="grid size-6 place-items-center rounded-md text-[var(--pv-mute)] hover:bg-[var(--pv-sub)]">
            <Minus className="size-3.5" />
          </button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)} className="w-10 text-center tabular-nums hover:text-[var(--pv-mute)]">
            {Math.round(zoom * 100)}%
          </button>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))} className="grid size-6 place-items-center rounded-md text-[var(--pv-mute)] hover:bg-[var(--pv-sub)]">
            <Plus className="size-3.5" />
          </button>
        </div>

        {/* ── prompt box ── */}
        <div className="absolute bottom-4 left-1/2 z-30 w-[600px] -translate-x-1/2 whitespace-nowrap rounded-2xl border border-[var(--pv-bd)] bg-[var(--pv-panel)] p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
          <textarea
            value={prompt}
            readOnly={mode === "demo"}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="w-full resize-none bg-transparent text-[12.5px] leading-relaxed outline-none"
            aria-label="Task prompt"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex rounded-lg bg-[var(--pv-sub)] p-0.5 text-[11px] font-medium">
              {(["demo", "custom"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    if (m === "demo") setPrompt(DEFAULT_PROMPT);
                  }}
                  className={`h-6 rounded-md px-2.5 capitalize transition-colors ${mode === m ? "bg-[var(--pv-panel)] shadow-sm" : "text-[var(--pv-mute)]"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--pv-sub)] px-2 text-[11px] text-[var(--pv-mute)]">
              Budget
              <input
                type="number"
                min={11}
                max={500}
                value={budget}
                disabled={running}
                onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))}
                className="w-7 bg-transparent font-mono font-semibold text-[var(--pv-fg)] outline-none"
              />
            </label>
            <label className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--pv-sub)] px-2 text-[11px] text-[var(--pv-mute)]">
              Quality
              <input
                type="number"
                min={0}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                className="w-7 bg-transparent font-mono font-semibold text-[var(--pv-fg)] outline-none"
              />
            </label>
            <button
              onClick={() => run(false)}
              disabled={running}
              className="ml-auto h-8 rounded-lg px-2.5 text-[11px] text-[var(--pv-mute)] transition-colors hover:bg-[var(--pv-sub)] hover:text-[var(--pv-fg)] disabled:opacity-40"
            >
              Run unoptimized
            </button>
            <button
              onClick={() => run(true)}
              disabled={running}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--pv-ink)] px-3.5 text-[12px] font-semibold text-[var(--pv-inkfg)] transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              <Sparkles className="size-[14px]" />
              {running ? "Running…" : "Optimize Prompt"}
            </button>
          </div>
        </div>

        {modalEl(false)}
      </div>
    </div>
  );
}
