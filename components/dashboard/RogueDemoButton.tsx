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
    <div className="space-y-2">
      <Button variant="destructive" className="w-full" onClick={fire} disabled={!taskId || firing}>
        <ShieldAlert className="size-4" />
        {firing ? "Firing rogue transaction..." : "Fire Rogue Agent Demo"}
      </Button>
      {result && (
        <Alert variant={result.blocked ? "destructive" : "default"}>
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
