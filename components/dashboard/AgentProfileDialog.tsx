"use client";

import { useEffect, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authHeader } from "@/lib/auth/clientAuth";
import type { SampleSummary } from "@/lib/agents/profile";

interface TimelinePoint {
  at: number;
  source: "benchmark" | "production";
  capability: string;
  qa: number;
  success: boolean;
}
interface Trend {
  direction: "improving" | "declining" | "steady" | "insufficient_data";
  earlierAvg: number | null;
  recentAvg: number | null;
  delta: number | null;
  samples: number;
}

function trendText(t: Trend): string {
  if (t.direction === "insufficient_data") return `Needs at least 4 measured runs to show a trend (${t.samples} so far).`;
  const label = t.direction === "improving" ? "Improving" : t.direction === "declining" ? "Declining" : "Steady";
  const delta = t.delta ?? 0;
  return `${label}: older runs averaged ${Math.round(t.earlierAvg ?? 0)}, recent runs ${Math.round(t.recentAvg ?? 0)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}).`;
}

function QualityChart({ points }: { points: TimelinePoint[] }) {
  if (points.length < 2) return <p className="text-xs text-panel-muted">Not enough runs yet to draw a chart.</p>;
  const W = 560;
  const H = 120;
  const P = 8;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (q: number) => H - P - (Math.max(0, Math.min(100, q)) / 100) * (H - 2 * P);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.qa).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="Quality score of each measured run, oldest to newest">
      {[0, 50, 100].map((g) => (
        <line key={g} x1={P} x2={W - P} y1={y(g)} y2={y(g)} className="stroke-panel-border" strokeDasharray="3 4" />
      ))}
      <path d={line} fill="none" className="stroke-panel-foreground" strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.qa)} r={3} className={p.source === "benchmark" ? "fill-panel-muted" : p.success ? "fill-emerald-500" : "fill-destructive"}>
          <title>{`${p.source} - ${p.capability.replace(/_/g, " ")} - quality ${Math.round(p.qa)} - ${new Date(p.at).toLocaleString()}`}</title>
        </circle>
      ))}
    </svg>
  );
}

interface Profile {
  agent: { id: string; name: string; visibility: string };
  benchmark: { source: string; overall: SampleSummary; byCapability: Record<string, SampleSummary> };
  production: {
    source: string;
    overall: SampleSummary;
    byCapability: Record<string, SampleSummary>;
    byDomain: Record<string, SampleSummary>;
    strongIn: string[];
    weakIn: string[];
  };
  improvement: { trend: Trend; timeline: TimelinePoint[]; recent: TimelinePoint[] };
  userRatings: { source: string; count: number; average: number | null };
  developerClaims: { source: string; description: string | null; capabilities: string[]; price: number };
}

const num = (v: number | null, f: (n: number) => string) => (v === null ? "—" : f(v));

function Section({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-panel-border px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-panel-foreground">{title}</h3>
        <span className="text-[11px] text-panel-muted">{source}</span>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, s }: { label: string; s: SampleSummary }) {
  return (
    <tr className="border-t border-panel-border/60 font-mono text-[12px] tabular-nums">
      <td className="py-1.5 pr-3 font-sans text-panel-foreground">{label.replace(/_/g, " ")}</td>
      <td className="px-2 text-right text-panel-muted">{s.samples}</td>
      <td className="px-2 text-right">{num(s.avgQuality, (n) => String(Math.round(n)))}</td>
      <td className="px-2 text-right">{num(s.successRate, (n) => `${Math.round(n * 100)}%`)}</td>
      <td className="px-2 text-right">{num(s.medianLatencyMs, (n) => `${(n / 1000).toFixed(1)}s`)}</td>
      <td className="pl-2 text-right">{num(s.avgCost, (n) => n.toFixed(1))}</td>
    </tr>
  );
}

function SummaryTable({ first, rows }: { first: string; rows: Array<[string, SampleSummary]> }) {
  if (rows.length === 0) return <p className="text-xs text-panel-muted">No measurements yet.</p>;
  return (
    <table className="w-full text-left text-[11px] tracking-wide text-panel-muted uppercase">
      <thead>
        <tr>
          <th className="pb-1 font-medium">{first}</th>
          <th className="px-2 pb-1 text-right font-medium">Runs</th>
          <th className="px-2 pb-1 text-right font-medium">Quality</th>
          <th className="px-2 pb-1 text-right font-medium">Success</th>
          <th className="px-2 pb-1 text-right font-medium">Latency</th>
          <th className="pb-1 pl-2 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody className="normal-case tracking-normal">
        {rows.map(([k, s]) => (
          <SummaryRow key={k} label={k} s={s} />
        ))}
      </tbody>
    </table>
  );
}

export function AgentProfileDialog({ agentId, open, onOpenChange }: { agentId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}/profile`, { headers: await authHeader() });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "Couldn't load this agent's profile.");
        else setProfile(data as Profile);
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4 pr-14">
          <DialogTitle className="text-lg font-semibold tracking-tight text-panel-foreground">{profile?.agent.name ?? "Agent profile"}</DialogTitle>
          <DialogDescription className="text-[13px] text-panel-muted">
            Four separate sources of truth - Kraven&apos;s benchmark, real task results, user ratings and the developer&apos;s own claims - are never blended.
          </DialogDescription>
        </DialogHeader>
        <DialogClose render={<Button variant="ghost" size="icon-sm" className="absolute top-5 right-5 text-panel-muted" />}>
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>

        <div className="space-y-3 px-6 pb-6">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!profile && !error && <p className="text-sm text-panel-muted">Loading…</p>}
          {profile && (
            <>
              <Section title="Improvement over time" source="Quality score of every measured run">
                <p className="mb-2 text-sm text-panel-foreground">{trendText(profile.improvement.trend)}</p>
                <QualityChart points={profile.improvement.timeline} />
                <p className="mt-1 text-[11px] text-panel-muted">Grey dots are Kraven benchmark runs; green and red are real tasks (passed / failed QA).</p>
                {profile.improvement.recent.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-panel-muted">
                    {profile.improvement.recent.map((r, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          {new Date(r.at).toLocaleString()} · {r.source} · {r.capability.replace(/_/g, " ")}
                        </span>
                        <span className={r.success ? "text-emerald-500" : "text-destructive"}>
                          quality {Math.round(r.qa)} · {r.success ? "passed" : "failed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Kraven benchmark" source={profile.benchmark.source}>
                <SummaryTable first="Capability" rows={Object.entries(profile.benchmark.byCapability)} />
              </Section>
              <Section title="Production performance" source={profile.production.source}>
                <SummaryTable first="Capability" rows={Object.entries(profile.production.byCapability)} />
                {Object.keys(profile.production.byDomain).length > 0 && (
                  <div className="mt-3">
                    <SummaryTable first="Domain" rows={Object.entries(profile.production.byDomain)} />
                  </div>
                )}
                {(profile.production.strongIn.length > 0 || profile.production.weakIn.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                    {profile.production.strongIn.map((d) => (
                      <Badge key={d} variant="outline" className="border-emerald-500/40 text-emerald-500">
                        Strong: {d.replace(/_/g, " ")}
                      </Badge>
                    ))}
                    {profile.production.weakIn.map((d) => (
                      <Badge key={d} variant="outline" className="border-destructive/40 text-destructive">
                        Weak: {d.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                )}
              </Section>
              <Section title="User ratings" source={profile.userRatings.source}>
                <p className="text-sm text-panel-foreground">
                  {profile.userRatings.average === null
                    ? "No ratings yet."
                    : `${profile.userRatings.average.toFixed(1)} / 5 from ${profile.userRatings.count} ${profile.userRatings.count === 1 ? "rating" : "ratings"}`}
                </p>
              </Section>
              <Section title="Developer claims" source={profile.developerClaims.source}>
                <p className="text-sm text-panel-foreground">{profile.developerClaims.description ?? "No description."}</p>
                <p className="mt-1 text-xs text-panel-muted">
                  Declared capabilities: {profile.developerClaims.capabilities.map((c) => c.replace(/_/g, " ")).join(", ")} · Price {profile.developerClaims.price}t
                </p>
              </Section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
