"use client";

import { useState, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TaskRecord, CentralLedgerRecord, AlgorandLedgerTransactionRecord } from "@/lib/types";
import { ChevronDown, ExternalLink } from "lucide-react";
import { TrustPanel, type BlockchainWorkflowEventRecord } from "@/components/dashboard/TrustPanel";
import { tokenRateLabel, tokensWorthLabel } from "@/lib/economy/tokenValue";

const ALGO_NETWORK = process.env.NEXT_PUBLIC_ALGOD_NETWORK || "testnet";
const algoExplorerTxUrl = (txId: string) => `https://lora.algokit.io/${ALGO_NETWORK}/transaction/${txId}`;
// Real Algorand transaction IDs are 52-char base32; mock/demo IDs (e.g.
// "x402-mirror-...", "x402-tx-...") don't match and would 404 on any
// explorer, so we only link out for IDs that look like the real thing.
const isRealAlgorandTxId = (txId: string) => /^[A-Z2-7]{52}$/.test(txId);

const VISIBLE_TRANSACTIONS = 6;

function sentenceCase(raw: string) {
  const spaced = raw.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "success" }) {
  return (
    <div className="px-3.5 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-base leading-none font-semibold tabular-nums transition-colors duration-300",
          tone === "danger" ? "text-destructive" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "APPROVED" || status === "CONFIRMED" || status === "SETTLED"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "BLOCKED" || status === "FAILED"
        ? "text-destructive"
        : "text-muted-foreground";
  return <span className={cn("text-[10px] font-medium tracking-wide uppercase transition-colors duration-300", tone)}>{status}</span>;
}

function ExplorerLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-muted-foreground"
    >
      <ExternalLink className="size-3" />
      {children}
    </a>
  );
}

export function EconomyContent({
  task,
  ledger,
  paymentIntents = [],
  blockchainTransactions = [],
  blockchainWorkflowEvents = [],
  algorandTransactions = [],
}: {
  task: TaskRecord | null;
  ledger: CentralLedgerRecord[];
  paymentIntents?: any[];
  blockchainTransactions?: any[];
  blockchainWorkflowEvents?: BlockchainWorkflowEventRecord[];
  algorandTransactions?: AlgorandLedgerTransactionRecord[];
}) {
  const [showAllTransactions, setShowAllTransactions] = useState(false);

  const budget = task?.budget ?? null;
  const remaining = task?.remainingBudget ?? null;
  const locked = task?.centralEscrow?.totalLocked ?? 0;
  const released = task?.centralEscrow?.totalReleased ?? 0;
  const refunded = task?.centralEscrow?.totalRefunded ?? 0;
  const blocked = ledger.filter((t) => t.status === "BLOCKED").length;

  // The bar shows only what the backend reports: tokens paid out and tokens
  // currently held in escrow, each as a share of the task budget.
  const pct = (n: number) => (budget && budget > 0 ? Math.min(100, Math.max(0, (n / budget) * 100)) : 0);

  const transactions = ledger.slice(0, 20);
  const visibleTransactions = showAllTransactions ? transactions : transactions.slice(0, VISIBLE_TRANSACTIONS);

  const hasChainDetails = paymentIntents.length > 0 || algorandTransactions.length > 0 || blockchainWorkflowEvents.length > 0;

  return (
    <ScrollArea className="h-full">
      <div className="animate-in fade-in space-y-8 px-5 py-5 duration-300">
        <section>
          <div className="text-xs text-muted-foreground">Remaining budget</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="font-mono text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">{remaining ?? "-"}</span>
            {budget != null && <span className="text-sm text-muted-foreground">of {budget} tokens</span>}
          </div>

          <div
            className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${released} tokens released and ${locked} tokens in escrow out of ${budget ?? 0}`}
          >
            <div className="bg-emerald-500 transition-[width] duration-500" style={{ width: `${pct(released)}%` }} />
            <div className="bg-foreground/30 transition-[width] duration-500" style={{ width: `${pct(locked)}%` }} />
          </div>

          <div className="mt-4 grid grid-cols-4 divide-x divide-border overflow-hidden rounded-xl border border-border">
            <Metric label="In escrow" value={locked} />
            <Metric label="Released" value={released} tone={released > 0 ? "success" : undefined} />
            <Metric label="Refunded" value={refunded} />
            <Metric label="Blocked" value={blocked} tone={blocked > 0 ? "danger" : undefined} />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {tokenRateLabel()}
            {budget != null && <> &middot; this task&rsquo;s budget is {tokensWorthLabel(budget)}</>}
          </p>
        </section>

        <section>
          <SectionHeading aside={transactions.length > 0 ? transactions.length : undefined}>Recent transactions</SectionHeading>
          {transactions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">No transactions yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {visibleTransactions.map((t) => (
                  <li
                    key={t.id}
                    className={cn(
                      "grid grid-cols-[1fr_auto_5.5rem] items-center gap-3 px-3.5 py-2.5 animate-in fade-in slide-in-from-top-1 duration-300 ease-out",
                      t.status === "BLOCKED" && "bg-destructive/5",
                    )}
                  >
                    <span className="truncate text-[13px] text-foreground">{sentenceCase(t.type)}</span>
                    <span className="text-right font-mono text-[13px] tabular-nums text-foreground">{t.amount}t</span>
                    <span className="text-right">
                      <StatusPill status={t.status} />
                    </span>
                  </li>
                ))}
              </ul>
              {transactions.length > VISIBLE_TRANSACTIONS && (
                <button
                  type="button"
                  onClick={() => setShowAllTransactions((v) => !v)}
                  className="mt-2 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  {showAllTransactions ? "Show fewer" : `Show all ${transactions.length}`}
                </button>
              )}
            </>
          )}
        </section>

        {hasChainDetails && (
          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
              <span>Payment &amp; blockchain details</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div className="animate-in fade-in slide-in-from-top-1 space-y-7 border-t border-border px-4 py-5 duration-200">
              {paymentIntents.length > 0 && (
                <div>
                  <SectionHeading>Multi-chain payments</SectionHeading>
                  <ul className="space-y-2">
                    {paymentIntents.map((pi: any) => {
                      const bt = blockchainTransactions.find((b: any) => b.paymentIntentId === pi.id);
                      let meta: any = null;
                      try {
                        if (bt?.rawMetadata) meta = JSON.parse(bt.rawMetadata);
                      } catch {}

                      const isAlgo = pi.currency === "ALGO";
                      const hasRealAlgoTx = isAlgo && !!pi.blockchainTxId && isRealAlgorandTxId(pi.blockchainTxId);
                      const txLink = isAlgo
                        ? hasRealAlgoTx
                          ? algoExplorerTxUrl(pi.blockchainTxId)
                          : null
                        : `https://sepolia.etherscan.io/tx/${pi.blockchainTxId}`;

                      return (
                        <li key={pi.id} className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium text-foreground">{isAlgo ? "Algorand" : "Ethereum"}</span>
                            <StatusPill status={pi.status} />
                          </div>
                          <div className="text-muted-foreground">
                            {pi.amount} {pi.currency}
                          </div>
                          {pi.blockchainTxId && (
                            <div className="truncate font-mono text-[11px]">
                              {txLink ? (
                                <ExplorerLink href={txLink}>{pi.blockchainTxId.substring(0, 18)}…</ExplorerLink>
                              ) : (
                                <span className="text-muted-foreground italic">{pi.blockchainTxId.substring(0, 18)}… (simulated)</span>
                              )}
                            </div>
                          )}
                          {!isAlgo && meta?.anchorTxHash && (
                            <div className="flex items-center justify-between gap-3 border-t border-dashed border-border pt-1.5 text-muted-foreground">
                              <span>Anchored ledger</span>
                              <a
                                href={`https://sepolia.etherscan.io/tx/${meta.anchorTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] text-emerald-600 underline underline-offset-2 hover:text-emerald-500 dark:text-emerald-400"
                              >
                                {meta.anchorTxHash.substring(0, 12)}…
                              </a>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {algorandTransactions.length > 0 && (
                <div>
                  <SectionHeading aside={ALGO_NETWORK}>Algorand wallet transfers</SectionHeading>
                  <ul className="space-y-2">
                    {algorandTransactions.map((tx) => {
                      const hasRealTx = isRealAlgorandTxId(tx.txId);
                      return (
                        <li key={tx.id} className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium text-foreground">{sentenceCase(tx.type)}</span>
                            <StatusPill status={tx.status} />
                          </div>
                          <div className="flex justify-between gap-3 text-muted-foreground">
                            <span>{tx.amount} tokens</span>
                            <span className="truncate">{sentenceCase(tx.purpose)}</span>
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {tx.fromAddress.slice(0, 6)}…{tx.fromAddress.slice(-4)} &rarr; {tx.toAddress.slice(0, 6)}…{tx.toAddress.slice(-4)}
                          </div>
                          <div className="truncate font-mono text-[11px]">
                            {hasRealTx ? (
                              <ExplorerLink href={algoExplorerTxUrl(tx.txId)}>{tx.txId.slice(0, 12)}…</ExplorerLink>
                            ) : (
                              <span className="text-muted-foreground italic">{tx.txId} (simulated)</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {blockchainWorkflowEvents.length > 0 && <TrustPanel events={blockchainWorkflowEvents} />}
            </div>
          </details>
        )}
      </div>
    </ScrollArea>
  );
}
