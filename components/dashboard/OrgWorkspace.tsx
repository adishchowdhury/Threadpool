"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronDown, Info, Loader2, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LoginDialog } from "@/components/auth/login-dialog";
import { AuditTrailPanel } from "@/components/dashboard/AuditTrailPanel";
import { useAuthUser } from "@/lib/use-auth-user";
import { firebaseConfigured } from "@/lib/firebase";
import { authHeader } from "@/lib/auth/clientAuth";
import { CAPABILITY_IDS, CAPABILITY_CATALOG } from "@/lib/capabilities/catalog";
import { USD_PER_TOKEN, inrToTokens, usdToTokens, tokenRateLabel, tokensToInr, tokensWorthLabel } from "@/lib/economy/tokenValue";
import { cn } from "@/lib/utils";

const MODEL_TIERS = ["economy", "standard", "premium"] as const;

type PriceUnit = "tokens" | "inr" | "usd";

function trimNumber(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

function tokensFromUnitValue(value: number, unit: PriceUnit): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (unit === "tokens") return Math.max(1, Math.round(value));
  if (unit === "inr") return inrToTokens(value);
  return usdToTokens(value);
}

function unitValueFromTokens(tokens: number, unit: PriceUnit): string {
  if (unit === "tokens") return String(tokens);
  if (unit === "inr") return trimNumber(tokensToInr(tokens), 2);
  return trimNumber(tokens * USD_PER_TOKEN, 4);
}

interface Org {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

interface ExternalAgent {
  id: string;
  name: string;
  role: string | null;
  capabilities: string[];
  price: number;
  endpoint: string | null;
  status: string;
  lifecycleStatus: string | null;
  avgQuality: number;
  avgLatencyMs: number;
  successRate: number;
  reputation: number;
  sampleCount: number;
  totalJobs: number;
  model: string | null;
}

function LifecycleBadge({ status }: { status: string | null }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "FAILED_CALIBRATION" || status === "SUSPENDED"
        ? "bg-destructive/10 text-destructive"
        : status === "CALIBRATING" || status === "PENDING"
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground";
  const dot =
    status === "ACTIVE"
      ? "bg-emerald-500"
      : status === "FAILED_CALIBRATION" || status === "SUSPENDED"
        ? "bg-destructive"
        : status === "CALIBRATING" || status === "PENDING"
          ? "bg-amber-500"
          : "bg-muted-foreground";
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium tracking-wide", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {(status ?? "UNKNOWN").replace(/_/g, " ")}
    </span>
  );
}

function CreateOrgForm({ onCreated }: { onCreated: (org: Org) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create your organization.");
        return;
      }
      onCreated(data.provider);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h2 className="text-xl font-semibold tracking-tight">Create your organization</h2>
      <p className="text-sm text-muted-foreground">
        Your organization owns the agents you register - they compete for real work in Kraven&apos;s marketplace alongside Kraven&apos;s built-in agents,
        gated by real calibration, ranked by the same capability/quality/cost/latency scoring.
      </p>
      <div className="w-full space-y-3 text-left">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="DeepResearch AI" autoFocus />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="org-desc">Description (optional)</FieldLabel>
          <Textarea id="org-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
      </div>
      <Button type="button" onClick={submit} disabled={!name.trim() || submitting} className="w-full">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : "Create organization"}
      </Button>
    </div>
  );
}

// A field's label, demoted below the default Label's size/weight - the
// heavy bold labels made a long form feel like a wall of shouting. Used
// throughout this form instead of <Label> directly.
function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {children}
    </Label>
  );
}

function RegisterAgentForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [price, setPrice] = useState(5); // authoritative value, always in whole tokens
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("tokens");
  const [priceInput, setPriceInput] = useState("5"); // what's actually typed, in `priceUnit`'s currency

  function handlePriceInput(raw: string) {
    setPriceInput(raw);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) setPrice(tokensFromUnitValue(n, priceUnit));
  }

  function handlePriceUnitChange(unit: PriceUnit) {
    setPriceUnit(unit);
    setPriceInput(unitValueFromTokens(price, unit));
  }
  const [modelTier, setModelTier] = useState<string>("standard");
  const [authToken, setAuthToken] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function toggleCapability(id: string) {
    setCapabilities((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit() {
    if (!name.trim() || capabilities.length === 0 || !endpoint.trim()) {
      toast.error("Name, at least one capability and an endpoint are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/agents/external", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          name,
          description: description || undefined,
          capabilities,
          endpoint,
          price,
          modelTier,
          authToken: authToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't register agent.");
        return;
      }
      toast.success(`${name} registered - test its connection, then calibrate it.`);
      onDone();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="agent-name">Agent name</FieldLabel>
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="DeepResearch" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <FieldLabel htmlFor="agent-price">Price / task</FieldLabel>
            <TooltipProvider delay={100}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  aria-label="What is a token worth?"
                  className="flex size-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-56 text-[11px] leading-snug">
                  {tokenRateLabel()}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex items-stretch gap-1.5">
            <div className="flex rounded-lg bg-muted p-0.5">
              {(["tokens", "inr", "usd"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => handlePriceUnitChange(u)}
                  aria-pressed={priceUnit === u}
                  className={cn(
                    "rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors",
                    priceUnit === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {u === "tokens" ? "tok" : u === "inr" ? "₹" : "$"}
                </button>
              ))}
            </div>
            <Input
              id="agent-price"
              type="number"
              min={priceUnit === "tokens" ? 1 : 0.0001}
              step={priceUnit === "tokens" ? 1 : priceUnit === "inr" ? 0.01 : 0.0001}
              value={priceInput}
              onChange={(e) => handlePriceInput(e.target.value)}
              className="w-24"
            />
          </div>

          <p className="text-[11px] whitespace-nowrap text-muted-foreground">
            {priceUnit === "tokens" ? `≈ ${tokensWorthLabel(price)}` : `= ${price} token${price === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel>Capabilities</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {CAPABILITY_IDS.map((id) => {
            const selected = capabilities.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleCapability(id)}
                title={CAPABILITY_CATALOG[id].plannerGuidance}
                aria-pressed={selected}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-foreground/10 bg-foreground text-background"
                    : "border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {selected && <Check className="size-3" />}
                {CAPABILITY_CATALOG[id].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="agent-endpoint">Endpoint base URL</FieldLabel>
        <Input
          id="agent-endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://your-agent.example.com/kraven"
        />
        <p className="text-xs text-muted-foreground">
          Kraven sends requests to <code className="rounded bg-muted px-1 py-0.5">{"{endpoint}"}/health</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5">{"{endpoint}"}/execute</code>.
        </p>
      </div>

      <div className="space-y-1.5">
        <FieldLabel htmlFor="agent-tier">Model tier</FieldLabel>
        <Select value={modelTier} onValueChange={(v) => setModelTier(v ?? "standard")}>
          <SelectTrigger id="agent-tier" className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_TIERS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Everything below is genuinely optional, so it starts collapsed
          rather than competing with the required fields above. */}
      <div className="border-t border-border/70 pt-4">
        <button
          type="button"
          onClick={() => setShowAuth((s) => !s)}
          aria-expanded={showAuth}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", showAuth && "rotate-180")} />
          Optional: description &amp; authentication
        </button>

        {showAuth && (
          <div className="mt-3 flex flex-col gap-4">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="agent-desc">Description</FieldLabel>
              <Textarea id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this agent does, in a sentence." />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="agent-auth">Auth token Kraven should send</FieldLabel>
              <Input
                id="agent-auth"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="sent as Authorization: Bearer <token>"
              />
              <p className="text-xs text-muted-foreground">Leave blank if your endpoint doesn&apos;t require authentication (the demo endpoint doesn&apos;t).</p>
            </div>
          </div>
        )}
      </div>

      <Button type="button" onClick={submit} disabled={submitting} className="self-start">
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            Register agent
            <ArrowRight className="size-3.5" />
          </>
        )}
      </Button>
    </div>
  );
}

function AgentRow({ agent, onChanged }: { agent: ExternalAgent; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean> | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [coverage, setCoverage] = useState<Array<{ capability: string; qaScore: number | null; calibrated: boolean }> | null>(null);

  async function testConnection() {
    setBusy("test");
    setChecklist(null);
    try {
      const res = await fetch(`/api/agents/external/${agent.id}/test-connection`, { method: "POST", headers: await authHeader() });
      const data = await res.json();
      setChecklist({ endpointReachable: data.endpointReachable, authenticationOk: data.authenticationOk, responseValid: data.responseValid });
      toast[data.ok ? "success" : "error"](data.message);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function calibrate() {
    setBusy("calibrate");
    setCalibrating(true);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/agents/external/${agent.id}/calibrate`, { method: "POST", headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't start calibration.");
        setCalibrating(false);
        return;
      }
      const poll = setInterval(async () => {
        const r = await fetch(`/api/agents/external/${agent.id}/calibration`, { headers });
        const d = await r.json();
        setCoverage(d.coverage ?? null);
        if (d.lifecycleStatus !== "CALIBRATING") {
          clearInterval(poll);
          setCalibrating(false);
          onChanged();
          toast[d.lifecycleStatus === "ACTIVE" ? "success" : "error"](
            d.lifecycleStatus === "ACTIVE" ? "Calibration complete - agent is ACTIVE." : "Calibration failed - agent did not meet the quality bar.",
          );
        }
      }, 2000);
    } catch {
      toast.error("Couldn't reach the server.");
      setCalibrating(false);
    } finally {
      setBusy(null);
    }
  }

  async function applyAction(action: "pause" | "suspend" | "reactivate") {
    setBusy(action);
    try {
      const res = await fetch(`/api/agents/external/${agent.id}`, {
        method: "PATCH",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Action failed.");
        return;
      }
      onChanged();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const measured = agent.sampleCount > 0;
  const stats: Array<{ label: string; value: string }> = [
    { label: "Quality", value: measured ? String(Math.round(agent.avgQuality)) : "—" },
    { label: "Reliability", value: measured ? `${Math.round(agent.successRate * 100)}%` : "—" },
    { label: "Latency", value: measured ? `${(agent.avgLatencyMs / 1000).toFixed(1)}s` : "—" },
    { label: "Tasks", value: String(agent.totalJobs) },
  ];

  return (
    <div className="group rounded-xl border border-border bg-card/40 transition-colors hover:border-border/90 hover:bg-card/70">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4 pb-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{agent.name}</span>
            <LifecycleBadge status={agent.lifecycleStatus} />
            {agent.model && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {agent.model}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agent.capabilities.map((c) => (
              <span
                key={c}
                className="rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {c.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-stretch divide-x divide-border/70 text-right">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 px-3.5 first:pl-0 last:pr-0">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{s.label}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {(checklist || calibrating || coverage) && (
        <div className="mx-4 mb-3.5 rounded-lg bg-muted/50 px-3 py-2.5">
          {checklist && (
            <ul className="space-y-1 text-xs">
              {Object.entries(checklist).map(([k, ok]) => (
                <li key={k} className={cn("flex items-center gap-1.5", ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                  <span className="font-mono">{ok ? "✓" : "✗"}</span>
                  <span className="text-foreground/80">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
          {(calibrating || coverage) && (
            <ul className="space-y-1 text-xs">
              {coverage?.map((c) => (
                <li key={c.capability} className="flex items-center gap-1.5">
                  {c.calibrated ? (
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">✓</span>
                  ) : (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  )}
                  <span className="text-foreground/80">{c.capability.replace(/_/g, " ")}</span>
                  {c.qaScore != null && <span className="font-mono text-muted-foreground">— {c.qaScore}</span>}
                </li>
              ))}
              {calibrating && !coverage && (
                <li className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Calibrating…
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-4 py-3">
        <Button size="sm" variant="outline" onClick={testConnection} disabled={busy !== null}>
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : "Test connection"}
        </Button>
        <Button size="sm" variant="outline" onClick={calibrate} disabled={busy !== null || calibrating}>
          {busy === "calibrate" || calibrating ? <Loader2 className="size-3.5 animate-spin" /> : "Calibrate"}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {agent.lifecycleStatus === "PAUSED" || agent.lifecycleStatus === "SUSPENDED" ? (
            <Button size="sm" variant="ghost" onClick={() => applyAction("reactivate")} disabled={busy !== null}>
              Reactivate
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => applyAction("pause")} disabled={busy !== null}>
              Pause
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => applyAction("suspend")} disabled={busy !== null}>
            Suspend
          </Button>
        </div>
      </div>
    </div>
  );
}

// §33: the producer-facing surface, entirely separate from the task-chat
// consumer UI it sits alongside - a mode switch (Sidebar), not a mixed
// dashboard. Identity comes from the SAME login already used for task
// submission (lib/use-auth-user.ts) - there is no separate provider
// account/API-key system. lib/auth/session.ts verifies the Firebase ID
// token server-side on every request this component makes.
export function OrgWorkspace() {
  const { user, loading: authLoading } = useAuthUser();
  const [loginOpen, setLoginOpen] = useState(false);
  const [org, setOrg] = useState<Org | null | undefined>(undefined); // undefined = loading, null = none yet
  const [agents, setAgents] = useState<ExternalAgent[]>([]);
  const [tab, setTab] = useState<"agents" | "register" | "audit">("agents");

  const requiresAuth = firebaseConfigured && !authLoading && !user;

  async function refresh() {
    try {
      const res = await fetch("/api/providers/me", { headers: await authHeader() });
      if (res.status === 404) {
        setOrg(null);
        return;
      }
      if (res.status === 401) {
        setOrg(undefined);
        return;
      }
      const data = await res.json();
      setOrg(data.provider);
      setAgents(data.agents ?? []);
    } catch {
      toast.error("Couldn't load your organization.");
    }
  }

  useEffect(() => {
    if (requiresAuth) return;
    refresh();
  }, [requiresAuth]);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (requiresAuth) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={refresh} />
        <h2 className="text-lg font-semibold">Sign in to manage your organization</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Organization mode lets you register your own agents to compete for real work in Kraven&apos;s marketplace. Sign in to continue.
        </p>
        <Button type="button" onClick={() => setLoginOpen(true)}>
          Sign in
        </Button>
      </div>
    );
  }

  if (org === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading your organization…
      </div>
    );
  }

  if (org === null) {
    return <CreateOrgForm onCreated={(o) => setOrg(o)} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6 sm:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your agents compete for real work alongside Kraven&apos;s built-in agents - ranked by the same capability, quality, reliability, cost and
          latency scoring, gated by real calibration.
        </p>

        <Tabs value={tab} onValueChange={(v) => setTab((v as typeof tab) ?? "agents")} className="mt-6">
          <TabsList variant="line">
            <TabsTrigger value="agents">My Agents ({agents.length})</TabsTrigger>
            <TabsTrigger value="register">
              <PlusIcon className="size-3.5" /> Register agent
            </TabsTrigger>
            <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="pt-4">
            {agents.length > 0 && (
              <div className="mb-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/agents/health/sweep", { method: "POST", headers: await authHeader() });
                      const data = await res.json();
                      if (!res.ok) {
                        toast.error(data.error ?? "Health check failed.");
                        return;
                      }
                      toast.success(`Checked ${data.checked} agent(s)${data.demoted ? `, demoted ${data.demoted}` : ""}.`);
                      refresh();
                    } catch {
                      toast.error("Couldn't reach the server.");
                    }
                  }}
                >
                  Run health check
                </Button>
              </div>
            )}
            <ScrollArea className="max-h-[60vh]">
              <div className="flex flex-col gap-3 pr-2">
                {agents.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No agents yet - register one to get started.</p>}
                {agents.map((a) => (
                  <AgentRow key={a.id} agent={a} onChanged={refresh} />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="register" className="pt-4">
            <RegisterAgentForm
              onDone={() => {
                refresh();
                setTab("agents");
              }}
            />
          </TabsContent>

          <TabsContent value="audit" className="pt-4">
            <AuditTrailPanel organizationId={org.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
