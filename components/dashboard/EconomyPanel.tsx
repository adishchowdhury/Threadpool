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

export function EconomyPanel({
  task,
  ledger,
  paymentIntents = [],
  blockchainTransactions = [],
}: {
  task: TaskRecord | null;
  ledger: CentralLedgerRecord[];
  paymentIntents?: any[];
  blockchainTransactions?: any[];
}) {
  const locked = task?.centralEscrow?.totalLocked ?? 0;
  const released = task?.centralEscrow?.totalReleased ?? 0;
  const refunded = task?.centralEscrow?.totalRefunded ?? 0;
  const blocked = ledger.filter((t) => t.status === "BLOCKED").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Economy & Blockchain Settlement</CardTitle>
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
        
        {paymentIntents.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="text-xs font-semibold text-primary mb-2 flex items-center justify-between">
                <span>Ethereum Sepolia x402 Payments</span>
                <span className="text-[10px] text-muted-foreground uppercase">Sepolia</span>
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                {paymentIntents.map((pi: any) => {
                  const bt = blockchainTransactions.find((b: any) => b.paymentIntentId === pi.id);
                  let meta: any = null;
                  try {
                    if (bt?.rawMetadata) meta = JSON.parse(bt.rawMetadata);
                  } catch {}

                  return (
                    <div key={pi.id} className="text-[11px] font-mono rounded border border-border bg-card p-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">Service Pay</span>
                        <span className={`px-1 py-0.2 rounded text-[9px] uppercase font-semibold ${
                          pi.status === "SETTLED" ? "bg-emerald-500/10 text-emerald-500" :
                          pi.status === "FAILED" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-500"
                        }`}>
                          {pi.status}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex justify-between">
                        <span>Amount: {pi.amount} {pi.currency}</span>
                        <span>Key: {pi.idempotencyKey.split("_").pop()}</span>
                      </div>
                      {pi.blockchainTxId && (
                        <div className="text-primary truncate">
                          Tx: <a
                            href={`https://sepolia.etherscan.io/tx/${pi.blockchainTxId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-primary/80"
                          >
                            {pi.blockchainTxId.substring(0, 18)}...
                          </a>
                        </div>
                      )}
                      {meta?.anchorTxHash && (
                        <div className="text-[10px] text-muted-foreground truncate pt-1 border-t border-dashed border-border/80 flex items-center justify-between">
                          <span>Anchored Ledger:</span>
                          <a
                            href={`https://sepolia.etherscan.io/tx/${meta.anchorTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-emerald-600 hover:text-emerald-500 font-semibold"
                          >
                            {meta.anchorTxHash.substring(0, 12)}...
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

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
