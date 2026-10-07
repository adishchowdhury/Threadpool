"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth/clientAuth";
import { cn } from "@/lib/utils";

// Post-task rating. The server accepts a rating only from the org that ran the
// task, for an agent that worked on it, once - and it never feeds benchmarks.
export function RateAgents({ taskId, agents }: { taskId: string; agents: Array<{ id: string; name: string }> }) {
  const [given, setGiven] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function rate(agentId: string, rating: number) {
    setBusy(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}/rating`, {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, rating }),
      });
      const data = await res.json();
      if (res.ok || res.status === 409) {
        setGiven((g) => ({ ...g, [agentId]: rating }));
        toast[res.ok ? "success" : "info"](res.ok ? "Thanks - rating saved." : (data.error ?? "Already rated."));
      } else {
        toast.error(data.error ?? "Couldn't save the rating.");
      }
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  if (agents.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
      <div className="mb-1.5 text-xs font-medium">Rate the agents that worked on this task</div>
      <ul className="space-y-1">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate">{a.name}</span>
            <span className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy === a.id || given[a.id] !== undefined}
                  onClick={() => rate(a.id, n)}
                  aria-label={`Rate ${a.name} ${n} out of 5`}
                  className="disabled:cursor-default"
                >
                  <Star className={cn("size-4", n <= (given[a.id] ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground hover:text-amber-400")} />
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
