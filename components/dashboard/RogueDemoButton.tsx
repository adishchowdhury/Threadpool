"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface RogueResult {
  blocked: boolean;
  reason: string | null;
  authorizedAmount: number;
  requestedAmount: number;
}

// Fires the real Circuit Breaker demo against the open task: an agent that was
// authorized for a few tokens asks for 10,000, and the backend must refuse it.
export function SecurityTest({ taskId }: { taskId: string | null }) {
  const [result, setResult] = useState<RogueResult | null>(null);
  const [firing, setFiring] = useState(false);

  async function fire() {
    if (!taskId) return;
    setFiring(true);
    setResult(null);
    try {
      const res = await fetch("/api/agents/rogue/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        toast.error(typeof data.error === "string" ? data.error : "The security test couldn't run.");
      }
    } catch {
      toast.error("Couldn't reach the server to run the security test.");
    } finally {
      setFiring(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Test the circuit breaker</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Simulates an agent that was cleared to spend a few tokens suddenly requesting 10,000. The request goes through the same payment checks as real
          work and should be blocked without touching any balance.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={fire} disabled={!taskId || firing} className="gap-1.5 transition-opacity">
          <ShieldAlert className={firing ? "size-3.5 animate-pulse" : "size-3.5"} />
          {firing ? "Running test…" : "Run security test"}
        </Button>
        {!taskId && (
          <p className="animate-in fade-in text-xs text-muted-foreground duration-300">Open or start a task first.</p>
        )}
      </div>
      {result && (
        <div
          role="status"
          className={
            (result.blocked
              ? "rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4"
              : "rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive") +
            " animate-in fade-in slide-in-from-bottom-2 zoom-in-95 duration-300 ease-out"
          }
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            {result.blocked ? (
              <ShieldCheck className="size-4 shrink-0 animate-in zoom-in-50 duration-500 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="size-4 shrink-0 animate-in zoom-in-50 duration-500" />
            )}
            {result.blocked ? "Blocked — the ledger is unchanged" : "Unexpectedly approved"}
          </div>
          <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Authorized {result.authorizedAmount} tokens · requested {result.requestedAmount.toLocaleString()}
            {result.reason ? ` · ${result.reason}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
