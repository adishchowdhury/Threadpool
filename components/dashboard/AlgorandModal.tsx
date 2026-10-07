"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface AlgorandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlgorandModal({ open, onOpenChange }: AlgorandModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const network = process.env.NEXT_PUBLIC_ALGOD_NETWORK || "mainnet";
  const address = process.env.NEXT_PUBLIC_ALGOD_SENDER_ADDRESS || "NHFMWTDE7A2IJE2TR46HRW2YZF273MJS76P6GOCDL365HGXWLNJXPODLL4";
  const explorerUrl = `https://lora.algokit.io/${network}/account/${address}`;
  const x402Endpoint = typeof window !== "undefined" ? `${window.location.origin}/api/x402/premium-market-research` : "/api/x402/premium-market-research";

  const curlCommand = `curl -i "${x402Endpoint}"`;

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Algorand wallet address copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCurl = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    toast.success("x402 test command copied!");
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/20">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-sm font-semibold">Algorand & x402 Status</DialogTitle>
                <Badge variant="outline" className="gap-1.5 shrink-0 border-emerald-500/20 bg-emerald-500/10 text-[10px] font-semibold text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {network.toUpperCase()}
                </Badge>
              </div>
              <DialogDescription className="text-xs">
                On-chain settlement for agent payments
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Network details */}
          <dl className="divide-y divide-border/50 rounded-lg border border-border/50">
            <div className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-xs">
              <dt className="text-muted-foreground">Algod server node</dt>
              <dd className="font-mono text-[11px] text-foreground">mainnet-api.algonode.cloud</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-xs">
              <dt className="text-muted-foreground">Protocol</dt>
              <dd className="font-mono text-[11px] text-foreground">x402 Exact AVM (USDC/ALGO)</dd>
            </div>
          </dl>

          {/* Receiving wallet */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Receiving wallet</span>
              <Button variant="ghost" size="sm" onClick={copyAddress} className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="rounded-md border border-border/50 bg-muted/40 p-2.5 font-mono text-[11px] break-all text-foreground">
              {address}
            </div>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              View on Algorand Explorer <ExternalLink className="size-3" />
            </a>
          </div>

          {/* x402 endpoint */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">x402 protected endpoint</span>
              <Button variant="ghost" size="sm" onClick={copyCurl} className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                {copiedCurl ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copiedCurl ? "Copied" : "Copy cURL"}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border border-border/50 bg-muted/40 p-2.5 font-mono text-[11px] text-foreground">
              {x402Endpoint}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Returns <span className="text-foreground">402 Payment Required</span> when unpaid; settles signed Algorand transactions on-chain.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
