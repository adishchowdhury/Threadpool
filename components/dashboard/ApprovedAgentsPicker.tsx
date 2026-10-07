"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentProfileDialog } from "@/components/dashboard/AgentProfileDialog";
import { authHeader } from "@/lib/auth/clientAuth";
import type { AgentRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type Level = "INTERNAL" | "SENSITIVE";
type Sort = "quality" | "price" | "name";

const SORT_LABEL: Record<Sort, string> = { quality: "Highest quality", price: "Lowest price", name: "Name" };
const pretty = (c: string) => c.replace(/_/g, " ");

// Lets the user explicitly allow specific Kraven-certified / marketplace
// agents to receive a restricted task's data. Your own organization's agents
// are always allowed, so they aren't listed. The server re-checks every id.
export function ApprovedAgentsPicker({
  open,
  onOpenChange,
  level,
  selected,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: Level;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [agents, setAgents] = useState<AgentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState("all");
  const [sort, setSort] = useState<Sort>("quality");
  const [detailsId, setDetailsId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || agents) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agents", { headers: await authHeader() });
        const data = await res.json();
        if (!cancelled) setAgents(data.agents ?? []);
      } catch {
        if (!cancelled) setError("Couldn't load agents.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agents]);

  // Internal data already goes to Kraven Certified agents, so only third-party
  // marketplace agents need an explicit OK. Sensitive data needs one for both.
  const eligible = useMemo(
    () => (agents ?? []).filter((a) => a.status === "ACTIVE" && (a.visibility === "MARKETPLACE" || (level === "SENSITIVE" && a.visibility === "CERTIFIED"))),
    [agents, level],
  );
  const capabilities = useMemo(() => [...new Set(eligible.flatMap((a) => a.capabilities))].sort(), [eligible]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = eligible
      .filter((a) => capability === "all" || a.capabilities.includes(capability))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.role ?? "").toLowerCase().includes(q) || a.capabilities.some((c) => pretty(c).includes(q)));
    const measured = (a: AgentRecord) => (a.sampleCount > 0 ? 1 : 0);
    return list.sort((a, b) => {
      if (sort === "price") return a.price - b.price;
      if (sort === "name") return a.name.localeCompare(b.name);
      return measured(b) - measured(a) || b.avgQuality - a.avgQuality;
    });
  }, [eligible, query, capability, sort]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allShownOn = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="gap-1 px-5 pt-5 pb-3">
            <DialogTitle className="text-base">Allow specific agents</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {level === "SENSITIVE" ? "This task is Sensitive - only your own agents are used by default." : "This task is Internal - marketplace agents are excluded by default."}{" "}
              Your organization&apos;s agents are always allowed; tick any others you trust with this data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 border-b border-border px-5 pb-3">
            <Input placeholder="Search agents" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9" />
            <div className="flex items-center gap-2">
              <Select value={capability} onValueChange={(v) => setCapability(v ?? "all")}>
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Filter by capability">
                  <SelectValue>{(v: string) => (v === "all" ? "All capabilities" : pretty(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All capabilities</SelectItem>
                  {capabilities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {pretty(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort((v ?? "quality") as Sort)}>
                <SelectTrigger className="h-8 w-36 shrink-0 text-xs" aria-label="Sort agents">
                  <SelectValue>{(v: string) => SORT_LABEL[v as Sort]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable pr-1">
            {error && <p className="px-5 py-6 text-sm text-destructive">{error}</p>}
            {!agents && !error && <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>}
            {agents && eligible.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No {level === "SENSITIVE" ? "certified or marketplace" : "marketplace"} agents are available to allow right now.
              </p>
            )}
            {agents && eligible.length > 0 && rows.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No agents match these filters.
                <button
                  type="button"
                  className="mt-1 block w-full underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    setCapability("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            <ul className="divide-y divide-border">
              {rows.map((a) => {
                const on = selected.includes(a.id);
                const measured = a.sampleCount > 0;
                return (
                  <li key={a.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/50", on && "bg-muted/40")}>
                      <input type="checkbox" checked={on} onChange={() => toggle(a.id)} aria-label={`Allow ${a.name}`} className="shrink-0 accent-current" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="truncate text-sm font-medium">{a.name}</span>
                          {a.visibility === "CERTIFIED" ? (
                            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] font-normal">
                              Certified
                            </Badge>
                          ) : (
                            <span className="shrink-0 truncate text-[11px] text-muted-foreground">· {a.providerName ?? "Marketplace"}</span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {measured ? `Quality ${Math.round(a.avgQuality)} · ${Math.round(a.successRate * 100)}% success` : "Not yet measured"} · {a.price}t/task
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setDetailsId(a.id);
                        }}
                        className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Details
                      </button>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter className="mx-0 mb-0 flex-row items-center justify-between gap-2 rounded-b-xl border-t border-border bg-transparent px-5 py-3 sm:justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selected.length} allowed</Badge>
              {rows.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => onChange(allShownOn ? selected.filter((id) => !rows.some((r) => r.id === id)) : [...new Set([...selected, ...rows.map((r) => r.id)])])}
                >
                  {allShownOn ? "Clear shown" : "Select shown"}
                </button>
              )}
            </div>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AgentProfileDialog key={detailsId ?? "none"} agentId={detailsId} open={detailsId !== null} onOpenChange={(o) => !o && setDetailsId(null)} />
    </>
  );
}
