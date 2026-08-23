"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { TaskRecord, CentralLedgerRecord, AlgorandLedgerTransactionRecord } from "@/lib/types";
import { useDraggable } from "@/lib/hooks/useDraggable";
import { ChevronLeft, ChevronRight, GripVertical, Wallet, ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import { TrustPanel, type BlockchainWorkflowEventRecord } from "@/components/dashboard/TrustPanel";
import type { SecurityEventRecord } from "@/lib/types";

const ALGO_NETWORK = process.env.NEXT_PUBLIC_ALGOD_NETWORK || "testnet";
const algoExplorerTxUrl = (txId: string) => `https://lora.algokit.io/${ALGO_NETWORK}/transaction/${txId}`;
// Real Algorand transaction IDs are 52-char base32; older mock IDs (e.g.
// "algo_mirror_...", "mock_tx_...") don't match and would 404 on any
// explorer, so we only link out for IDs that look like the real thing.
const isRealAlgorandTxId = (txId: string) => /^[A-Z2-7]{52}$/.test(txId);

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "success" }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-panel-muted">{label}</div>
      <div
        className={cn(
          "font-mono text-base font-semibold",
          tone === "danger" ? "text-rose-400" : tone === "success" ? "text-emerald-400" : "text-panel-foreground",
        )}
      >
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
  blockchainWorkflowEvents = [],
  algorandTransactions = [],
  securityEvents = [],
  open,
  onOpenChange,
}: {
  task: TaskRecord | null;
  ledger: CentralLedgerRecord[];
  paymentIntents?: any[];
  blockchainTransactions?: any[];
  blockchainWorkflowEvents?: BlockchainWorkflowEventRecord[];
  algorandTransactions?: AlgorandLedgerTransactionRecord[];
  securityEvents?: SecurityEventRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { containerRef, style, isDragging, handleProps } = useDraggable();
  const locked = task?.centralEscrow?.totalLocked ?? 0;
  const released = task?.centralEscrow?.totalReleased ?? 0;
  const refunded = task?.centralEscrow?.totalRefunded ?? 0;
  const blocked = ledger.filter((t) => t.status === "BLOCKED").length;

  if (!open) {
    return (
      <div className="pointer-events-auto absolute right-3 top-16 z-20 sm:right-4 sm:top-20">
        <Button
          variant="ghost"
          size="icon"
          className="group size-10 rounded-full border border-panel-border bg-panel text-panel-muted shadow-lg backdrop-blur-xl transition-all duration-200 ease-out hover:border-panel-border hover:bg-panel-elevated hover:text-panel-foreground hover:shadow-xl active:scale-95"
          onClick={() => onOpenChange(true)}
          aria-label="Expand economy panel"
          title="Expand economy panel"
        >
          <Wallet className="absolute size-3.5 opacity-100 transition-opacity duration-150 group-hover:opacity-0" />
          <ChevronLeft className="absolute size-4 opacity-0 transition-all duration-150 group-hover:-translate-x-0.5 group-hover:opacity-100" />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={style}
      className={cn(
        "pointer-events-auto absolute right-3 top-16 z-20 flex max-h-[calc(100%-13rem)] w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-lg border border-panel-border bg-panel text-panel-foreground shadow-xl backdrop-blur-xl sm:right-4 sm:top-20 sm:max-h-[calc(100%-5rem)] sm:w-72",
        !isDragging && "animate-in fade-in slide-in-from-right-2 duration-200 ease-out",
      )}
    >
      <div
        {...handleProps}
        className="flex select-none items-center justify-between gap-2 border-b border-panel-border px-3 py-2"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium tracking-tight">
          <GripVertical className="size-3.5 text-panel-muted/60" />
          Economy
          <Wallet className="size-3.5 text-panel-muted" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-full text-panel-muted transition-colors hover:bg-panel-elevated hover:text-panel-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Collapse economy panel"
          title="Collapse economy panel"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0">
        <div className="animate-in fade-in space-y-4 p-3.5 duration-300">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Task Budget" value={task?.budget ?? "—"} />
            <Stat label="Remaining" value={task?.remainingBudget ?? "—"} />
            <Stat label="Escrow Locked" value={locked} />
            <Stat label="Released" value={released} tone="success" />
            <Stat label="Refunded" value={refunded} />
            <Stat label="Blocked Attempts" value={blocked} tone={blocked > 0 ? "danger" : undefined} />
          </div>

          <Separator className="bg-panel-border" />
          <div
            className={cn(
              "rounded-md border p-2.5 text-xs",
              blocked > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
            )}
          >
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
              {blocked > 0 ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
              {blocked > 0 ? "Circuit Breaker Triggered" : "System Secure"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-panel-foreground">
              Authorized spend: {locked + released}t / {task?.budget ?? "—"}t
            </div>
            {securityEvents.length > 0 && (
              <div className="mt-1.5 border-t border-current/20 pt-1.5 font-mono text-[10px] text-panel-foreground">
                <div className="text-panel-muted">Latest blocked attempt:</div>
                <div>
                  {securityEvents[0].agentId ?? "unknown agent"} requested{" "}
                  {securityEvents[0].requestedAmount ?? "?"}t, authorized {securityEvents[0].allowedAmount ?? "?"}t
                </div>
                <div className="text-panel-muted">{securityEvents[0].reason}</div>
              </div>
            )}
          </div>

          {paymentIntents.length > 0 && (
            <>
              <Separator className="bg-panel-border" />
              <div>
                <div className="mb-2 flex items-center justify-between text-[11px] text-panel-muted">
                  <span>Multi-Chain x402 Payments</span>
                  <span className="text-[10px] uppercase text-panel-muted">Settled</span>
                </div>
                <div className="max-h-32 space-y-2 overflow-y-auto pr-1">
                  {paymentIntents.map((pi: any) => {
                    const bt = blockchainTransactions.find((b: any) => b.paymentIntentId === pi.id);
                    let meta: any = null;
                    try {
                      if (bt?.rawMetadata) meta = JSON.parse(bt.rawMetadata);
                    } catch {}

                    const isAlgo = pi.currency === "ALGO";
                    const hasRealAlgoTx = isAlgo && !!pi.blockchainTxId && isRealAlgorandTxId(pi.blockchainTxId);
                    const txLink = isAlgo
                      ? (hasRealAlgoTx ? algoExplorerTxUrl(pi.blockchainTxId) : null)
                      : `https://sepolia.etherscan.io/tx/${pi.blockchainTxId}`;

                    return (
                      <div key={pi.id} className="space-y-1 rounded-sm border border-panel-border bg-panel-elevated p-2 font-mono text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-panel-foreground">{isAlgo ? "Algorand Pay" : "Ethereum Pay"}</span>
                          <span className={`px-1 py-0.2 rounded text-[9px] font-semibold uppercase ${
                            pi.status === "SETTLED" ? "bg-emerald-500/10 text-emerald-400" :
                            pi.status === "FAILED" ? "bg-destructive/15 text-rose-400" : "bg-amber-500/10 text-amber-400"
                          }`}>
                            {pi.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-panel-muted">
                          <span>Amount: {pi.amount} {pi.currency}</span>
                          <span>Key: {pi.idempotencyKey.split("_").pop()}</span>
                        </div>
                        {pi.blockchainTxId && (
                          <div className="truncate text-panel-foreground">
                            Tx: {txLink ? (
                              <a
                                href={txLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 underline hover:text-panel-muted"
                              >
                                {isAlgo && <ExternalLink className="size-2.5" />}
                                {pi.blockchainTxId.substring(0, 18)}...
                              </a>
                            ) : (
                              <span className="italic text-panel-muted">{pi.blockchainTxId.substring(0, 18)}... (simulated)</span>
                            )}
                          </div>
                        )}
                        {!isAlgo && meta?.anchorTxHash && (
                          <div className="flex items-center justify-between truncate border-t border-dashed border-panel-border pt-1 text-[10px] text-panel-muted">
                            <span>Anchored Ledger:</span>
                            <a
                              href={`https://sepolia.etherscan.io/tx/${meta.anchorTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-emerald-400 underline hover:text-emerald-300"
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

          <Separator className="bg-panel-border" />
          <div>
            <div className="mb-2 text-[11px] text-panel-muted">Recent Transactions</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {ledger.length === 0 && <p className="text-xs text-panel-muted">No transactions yet.</p>}
              {ledger.slice(0, 20).map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center justify-between rounded-sm px-2 py-1 font-mono text-[11px]",
                    t.status === "BLOCKED" ? "bg-destructive/15 text-rose-400" : "bg-panel-elevated text-panel-foreground",
                  )}
                >
                  <span>{t.type}</span>
                  <span>{t.amount}t</span>
                  <span>{t.status}</span>
                </div>
              ))}
            </div>
          </div>

          {algorandTransactions.length > 0 && (
            <>
              <Separator className="bg-panel-border" />
              <div>
                <div className="mb-2 flex items-center justify-between text-[11px] text-panel-muted">
                  <span>Algorand Wallet Transfers</span>
                  <span className="text-[10px] uppercase text-panel-muted">{ALGO_NETWORK}</span>
                </div>
                <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                  {algorandTransactions.map((tx) => {
                    const hasRealTx = isRealAlgorandTxId(tx.txId);
                    return (
                      <div
                        key={tx.id}
                        className="space-y-1 rounded-sm border border-panel-border bg-panel-elevated p-2 font-mono text-[11px]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-panel-foreground">{tx.type}</span>
                          <span
                            className={cn(
                              "px-1 py-0.2 rounded text-[9px] font-semibold uppercase",
                              tx.status === "CONFIRMED" ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/15 text-rose-400",
                            )}
                          >
                            {tx.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-panel-muted">
                          <span>Amount: {tx.amount}</span>
                          <span>{tx.purpose}</span>
                        </div>
                        <div className="truncate text-panel-muted">
                          {tx.fromAddress.slice(0, 6)}…{tx.fromAddress.slice(-4)} → {tx.toAddress.slice(0, 6)}…{tx.toAddress.slice(-4)}
                        </div>
                        <div className="truncate text-panel-foreground">
                          {hasRealTx ? (
                            <a
                              href={algoExplorerTxUrl(tx.txId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 underline hover:text-panel-muted"
                            >
                              <ExternalLink className="size-2.5" />
                              View on Algorand: {tx.txId.slice(0, 12)}...
                            </a>
                          ) : (
                            <span className="italic text-panel-muted">{tx.txId} (simulated)</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {blockchainWorkflowEvents.length > 0 && (
            <>
              <Separator className="bg-panel-border" />
              <TrustPanel events={blockchainWorkflowEvents} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
