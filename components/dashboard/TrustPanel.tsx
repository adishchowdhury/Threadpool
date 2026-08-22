import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ExternalLink } from "lucide-react";

const ALGO_NETWORK = process.env.NEXT_PUBLIC_ALGOD_NETWORK || "testnet";
const MANAGER_ALGO_ADDRESS = process.env.NEXT_PUBLIC_ALGOD_SENDER_ADDRESS || "";
const algoExplorerTxUrl = (txId: string) => `https://lora.algokit.io/${ALGO_NETWORK}/transaction/${txId}`;
const algoExplorerAccountUrl = (address: string) => `https://lora.algokit.io/${ALGO_NETWORK}/account/${address}`;
// Real Algorand transaction IDs are 52-char base32. Older/mock IDs (e.g.
// "algorand_trust_tx_...") don't match this and would 404 on any explorer,
// so we only ever link out for IDs that look like the real thing.
const isRealAlgorandTxId = (txId: string) => /^[A-Z2-7]{52}$/.test(txId);

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

export function TrustPanel({
  events = [],
}: {
  events?: BlockchainWorkflowEventRecord[];
}) {
  const isEnabled = process.env.NEXT_PUBLIC_BLOCKCHAIN_ENABLED !== "false";

  return (
    <Card className="border border-border/80 shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Verifiable AI Workforce (Algorand Trust)</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
            isEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
          }`}>
            {isEnabled ? "Algorand Enabled" : "Not Configured"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Critical agent handoffs and verification proofs are cryptographically committed to Algorand as an immutable audit trail.
        </div>

        {MANAGER_ALGO_ADDRESS && (
          <a
            href={algoExplorerAccountUrl(MANAGER_ALGO_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] font-mono text-primary transition-colors hover:bg-primary/10"
          >
            <span className="flex items-center gap-1.5">
              <ExternalLink className="size-3" />
              Full transaction history on Algorand ({ALGO_NETWORK})
            </span>
            <span className="truncate text-primary/70">
              {MANAGER_ALGO_ADDRESS.slice(0, 8)}…{MANAGER_ALGO_ADDRESS.slice(-6)}
            </span>
          </a>
        )}

        <Separator />

        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="text-xs italic text-muted-foreground text-center py-4">
              Awaiting task dispatch to anchor workflow proofs...
            </div>
          ) : (
            <div className="relative border-l border-border/60 pl-4 ml-2 space-y-4">
              {events.map((ev) => {
                const isConfirmed = ev.status === "CONFIRMED";
                const isSkipped = ev.status === "SKIPPED";
                const isFailed = ev.status === "FAILED";
                
                let title = ev.eventType.replace("_", " ");
                let toneClass = "text-foreground font-semibold";
                let iconBg = "bg-primary";

                if (ev.eventType === "RESULT_VERIFIED") {
                  title = "RESULT INTEGRITY VERIFIED";
                  toneClass = "text-emerald-500 font-bold";
                  iconBg = "bg-emerald-500";
                } else if (ev.eventType === "QA_APPROVED") {
                  toneClass = "text-emerald-500 font-semibold";
                  iconBg = "bg-emerald-500";
                } else if (ev.eventType === "QA_REJECTED") {
                  toneClass = "text-destructive font-semibold";
                  iconBg = "bg-destructive";
                }

                const explorerLink = ev.transactionId && isRealAlgorandTxId(ev.transactionId)
                  ? algoExplorerTxUrl(ev.transactionId)
                  : null;
                const isLegacySimulated = !!ev.transactionId && !explorerLink;

                return (
                  <div key={ev.id} className="relative text-[11px] font-mono space-y-1">
                    {/* Circle icon on the timeline line */}
                    <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${iconBg} ring-4 ring-background`} />

                    <div className="flex items-center justify-between">
                      <span className={`uppercase tracking-wide text-xs ${toneClass}`}>
                        {title}
                      </span>
                      <span className={`px-1 rounded text-[9px] uppercase font-semibold ${
                        isConfirmed ? "bg-emerald-500/10 text-emerald-500" :
                        isSkipped ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"
                      }`}>
                        {ev.status}
                      </span>
                    </div>

                    <div className="text-muted-foreground text-[10px] flex flex-col space-y-0.5">
                      {ev.fromAgentId && (
                        <div>From: <span className="text-foreground">{ev.fromAgentId}</span> {ev.toAgentId && <>to <span className="text-foreground">{ev.toAgentId}</span></>}</div>
                      )}
                      <div className="truncate">Proof: <span className="text-foreground font-semibold">{ev.payloadHash.substring(0, 24)}...</span></div>
                      {explorerLink && (
                        <a
                          href={explorerLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 pt-0.5 text-primary hover:text-primary/80"
                        >
                          <ExternalLink className="size-2.5" />
                          <span className="underline">View on Algorand: {ev.transactionId?.substring(0, 12)}...</span>
                        </a>
                      )}
                      {isLegacySimulated && (
                        <div className="pt-0.5 text-muted-foreground/70 italic">
                          Simulated tx (recorded before live anchoring was enabled) — not viewable on-chain.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
