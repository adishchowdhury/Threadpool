"use client";

import { useEffect, useState } from "react";
import { authHeader } from "@/lib/auth/clientAuth";
import type { ArenaDimension } from "@/lib/agents/profile";

interface Ranked {
  agentId: string;
  name: string;
  rank: number;
  samples: number;
  avgQuality: number;
  successRate: number;
  medianLatencyMs: number;
  price: number;
}

interface ArenaResponse {
  capability: string;
  unmeasured: string[];
  rankings: Record<ArenaDimension, Ranked[]>;
}

const COLUMNS: Array<{ key: ArenaDimension; title: string; hint: string; show: (r: Ranked) => string }> = [
  { key: "quality", title: "Highest quality", hint: "average QA score", show: (r) => `${Math.round(r.avgQuality)}` },
  { key: "reliability", title: "Most reliable", hint: "success rate", show: (r) => `${Math.round(r.successRate * 100)}%` },
  { key: "speed", title: "Fastest", hint: "average latency", show: (r) => `${(r.medianLatencyMs / 1000).toFixed(1)}s` },
  { key: "value", title: "Best value", hint: "quality per token", show: (r) => `${(r.avgQuality / Math.max(r.price, 1)).toFixed(1)}/t` },
];

export function ArenaView({ capability, onOpenAgent }: { capability: string; onOpenAgent: (id: string) => void }) {
  const [data, setData] = useState<ArenaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/arena?capability=${encodeURIComponent(capability)}`, { headers: await authHeader() });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? "Couldn't load the arena.");
        else setData(body as ArenaResponse);
      } catch {
        if (!cancelled) setError("Couldn't reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capability]);

  if (error) return <p className="px-8 py-10 text-sm text-destructive">{error}</p>;
  if (!data) return <p className="px-8 py-10 text-sm text-panel-muted">Loading…</p>;

  const any = COLUMNS.some((c) => data.rankings[c.key].length > 0);
  return (
    <div className="max-h-[55vh] overflow-y-auto px-8 py-5">
      {!any ? (
        <p className="py-8 text-center text-sm text-panel-muted">No agent has measured results for this capability yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((c) => (
            <div key={c.key} className="rounded-lg border border-panel-border px-3 py-3">
              <div className="text-sm font-semibold text-panel-foreground">{c.title}</div>
              <div className="mb-2 text-[11px] text-panel-muted">{c.hint}</div>
              <ol className="space-y-1">
                {data.rankings[c.key].map((r) => (
                  <li key={r.agentId}>
                    <button
                      type="button"
                      onClick={() => onOpenAgent(r.agentId)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[13px] hover:bg-panel-elevated"
                    >
                      <span className="w-4 text-panel-muted tabular-nums">{r.rank}</span>
                      <span className="min-w-0 flex-1 truncate text-panel-foreground">{r.name}</span>
                      <span className="font-mono text-xs tabular-nums text-panel-foreground">{c.show(r)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {data.unmeasured.length > 0 && (
        <p className="mt-4 text-xs text-panel-muted">Not ranked yet (no measured results): {data.unmeasured.join(", ")}.</p>
      )}
      <p className="mt-2 text-xs text-panel-muted">
        An agent doesn&apos;t need to be #1 overall - Kraven picks the one that fits the task&apos;s needs. Only measured results are ranked.
      </p>
    </div>
  );
}
