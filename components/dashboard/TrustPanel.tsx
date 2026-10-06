"use client";

import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const ALGO_NETWORK = process.env.NEXT_PUBLIC_ALGOD_NETWORK || "testnet";
const MANAGER_ALGO_ADDRESS = process.env.NEXT_PUBLIC_ALGOD_SENDER_ADDRESS || "";
const algoExplorerTxUrl = (txId: string) => `https://lora.algokit.io/${ALGO_NETWORK}/transaction/${txId}`;
const algoExplorerAccountUrl = (address: string) => `https://lora.algokit.io/${ALGO_NETWORK}/account/${address}`;
// Real Algorand transaction IDs are 52-char base32. Older/mock IDs (e.g.
// "algorand_trust_tx_...") don't match this and would 404 on any explorer,
// so we only ever link out for IDs that look like the real thing.
const isRealAlgorandTxId = (txId: string) => /^[A-Z2-7]{52}$/.test(txId);

const VISIBLE_EVENTS = 6;

export interface BlockchainWorkflowEventRecord {
  id: string;
  workflowId: string;
  taskId: string | null;
  eventType: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  payloadHash: string;
  canonicalPayloadVersion: number;
  network: string;
  transactionId: string | null;
  status: string;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

function sentenceCase(raw: string) {
  const spaced = raw.toLowerCase().replace(/_/g, " ").replace(/\bqa\b/g, "QA");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const EVENT_TITLES: Record<string, string> = {
  RESULT_VERIFIED: "Result integrity verified",
};

export function TrustPanel({
  events = [],
}: {
  events?: BlockchainWorkflowEventRecord[];
}) {
  const [showAll, setShowAll] = useState(false);

  // Status is derived from what actually happened to these events, not from a
  // client-side flag: anchoring can be "enabled" yet skipped server-side when
  // no signing account is configured.
  const confirmedCount = events.filter((e) => e.status === "CONFIRMED").length;
  const skippedCount = events.filter((e) => e.status === "SKIPPED").length;
  const failedCount = events.filter((e) => e.status === "FAILED").length;
  const allSkipped = events.length > 0 && skippedCount === events.length;

  const badge =
    confirmedCount > 0
      ? { label: `${confirmedCount} on-chain`, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
      : failedCount > 0
        ? { label: "Anchoring failed", tone: "bg-destructive/10 text-destructive" }
        : events.length > 0
          ? { label: "Not anchored", tone: "bg-muted text-muted-foreground" }
          : null;

  const visible = showAll ? events : events.slice(0, VISIBLE_EVENTS);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Algorand audit trail</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Key handoffs and verification proofs, hashed so any later change to a result is detectable.
          </p>
        </div>
        {badge && (
          <span
            className={cn(
              "animate-in fade-in zoom-in-95 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase transition-colors duration-300",
              badge.tone,
            )}
          >
            {badge.label}
          </span>
        )}
      </div>

      {allSkipped && (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          On-chain anchoring was skipped for this run &mdash; no Algorand signing account is configured. The proof hashes below were still recorded.
        </p>
      )}

      {/* The account page lists every proof anchored from this workspace, so it stays useful even when this run was skipped. */}
      {MANAGER_ALGO_ADDRESS && (
        <a
          href={algoExplorerAccountUrl(MANAGER_ALGO_ADDRESS)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/60"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">All anchored proofs on Algorand ({ALGO_NETWORK})</span>
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {MANAGER_ALGO_ADDRESS.slice(0, 6)}…{MANAGER_ALGO_ADDRESS.slice(-4)}
          </span>
        </a>
      )}

      {events.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Awaiting task dispatch to anchor workflow proofs…</p>
      ) : (
        <div>
          <ol className="relative ml-1.5 space-y-4 border-l border-border pl-5">
            {visible.map((ev) => {
              const positive = ev.eventType === "RESULT_VERIFIED" || ev.eventType === "QA_APPROVED";
              const negative = ev.eventType === "QA_REJECTED";
              const dot = positive ? "bg-emerald-500" : negative ? "bg-destructive" : "bg-muted-foreground/50";
              const titleTone = positive ? "text-emerald-600 dark:text-emerald-400" : negative ? "text-destructive" : "text-foreground";

              const explorerLink = ev.transactionId && isRealAlgorandTxId(ev.transactionId) ? algoExplorerTxUrl(ev.transactionId) : null;
              const isLegacySimulated = !!ev.transactionId && !explorerLink;
              // SKIPPED is explained once above; only surface a per-row status when it adds information.
              const showStatus = ev.status !== "SKIPPED";

              return (
                <li key={ev.id} className="animate-in fade-in slide-in-from-left-1 relative duration-300 ease-out">
                  <span className={cn("absolute top-1.5 -left-6 size-2 rounded-full ring-4 ring-background transition-colors duration-300", dot)} />

                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn("text-[13px] leading-snug font-medium", titleTone)}>
                      {EVENT_TITLES[ev.eventType] ?? sentenceCase(ev.eventType)}
                    </span>
                    {showStatus && (
                      <span
                        className={cn(
                          "shrink-0 text-[10px] font-medium tracking-wide uppercase",
                          ev.status === "CONFIRMED" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                        )}
                      >
                        {ev.status}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {ev.fromAgentId ? (
                        <>
                          {ev.fromAgentId}
                          {ev.toAgentId && <> &rarr; {ev.toAgentId}</>}
                        </>
                      ) : null}
                    </span>
                    <span title={ev.payloadHash} className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {ev.payloadHash.substring(0, 10)}…
                    </span>
                  </div>

                  {explorerLink && (
                    <a
                      href={explorerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2 hover:text-muted-foreground"
                    >
                      <ExternalLink className="size-3" />
                      View on Algorand
                    </a>
                  )}
                  {isLegacySimulated && (
                    <p className="mt-1.5 text-xs italic text-muted-foreground/80">
                      Simulated transaction (recorded before live anchoring was enabled) &mdash; not viewable on-chain.
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {events.length > VISIBLE_EVENTS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-4 ml-1.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${events.length} steps`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
