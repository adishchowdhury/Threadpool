"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export function RogueDemoButton({ taskId }: { taskId: string | null }) {
  const [result, setResult] = useState<{ blocked: boolean; reason: string | null; authorizedAmount: number; requestedAmount: number } | null>(null);
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
        toast.error(typeof data.error === "string" ? data.error : "Rogue demo request failed.");
      }
    } catch {
      toast.error("Couldn't reach the server to fire the rogue demo.");
    } finally {
      setFiring(false);
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={fire}
        disabled={!taskId || firing}
        className="text-destructive hover:bg-destructive/10"
        aria-label={firing ? "Firing rogue tx..." : "Fire Rogue Demo"}
      >
        <ShieldAlert className="size-3.5" />
        <span className="hidden sm:inline">{firing ? "Firing rogue tx..." : "Fire Rogue Demo"}</span>
      </Button>
      {result && (
        <Alert
          variant={result.blocked ? "destructive" : "default"}
          className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-md shadow-2xl"
        >
          <ShieldAlert className="size-4" />
          <AlertTitle>{result.blocked ? "CIRCUIT BREAKER: BLOCKED" : "Unexpectedly approved"}</AlertTitle>
          <AlertDescription>
            Authorized: {result.authorizedAmount}t · Requested: {result.requestedAmount}t
            {result.reason ? ` · Reason: ${result.reason}` : ""}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
