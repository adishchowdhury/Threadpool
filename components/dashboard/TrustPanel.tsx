import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

                const explorerLink = ev.transactionId
                  ? `https://testnet.explorer.perawallet.app/tx/${ev.transactionId}`
                  : null;

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
                        <div className="text-primary pt-0.5">
                          Algorand Tx: <a
                            href={explorerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-primary/80"
                          >
                            {ev.transactionId?.substring(0, 16)}...
                          </a>
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
