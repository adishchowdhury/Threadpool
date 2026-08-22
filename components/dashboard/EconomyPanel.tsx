"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { TaskRecord, CentralLedgerRecord } from "@/lib/types";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "success" }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono ${tone === "danger" ? "text-destructive" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function EconomyPanel({ task, ledger }: { task: TaskRecord | null; ledger: CentralLedgerRecord[] }) {
  const locked = task?.centralEscrow?.totalLocked ?? 0;
  const released = task?.centralEscrow?.totalReleased ?? 0;
  const refunded = task?.centralEscrow?.totalRefunded ?? 0;
  const blocked = ledger.filter((t) => t.status === "BLOCKED").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Economy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Task Budget" value={task?.budget ?? "—"} />
          <Stat label="Remaining" value={task?.remainingBudget ?? "—"} />
          <Stat label="Escrow Locked" value={locked} />
          <Stat label="Released" value={released} tone="success" />
          <Stat label="Refunded" value={refunded} />
          <Stat label="Blocked Attempts" value={blocked} tone={blocked > 0 ? "danger" : undefined} />
        </div>
        <Separator />
        <div>
          <div className="text-xs text-muted-foreground mb-2">Recent Transactions</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {ledger.length === 0 && <p className="text-xs text-muted-foreground">No transactions yet.</p>}
            {ledger.slice(0, 15).map((t) => (
              <div key={t.id} className={`flex items-center justify-between text-xs font-mono rounded px-2 py-1 ${t.status === "BLOCKED" ? "bg-destructive/10 text-destructive" : "bg-muted/40"}`}>
                <span>{t.type}</span>
                <span>{t.amount}t</span>
                <span>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
