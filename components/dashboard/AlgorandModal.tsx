"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ExternalLink, ShieldCheck, Zap } from "lucide-react";
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Zap className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Algorand Mainnet & x402 Status</DialogTitle>
              <DialogDescription className="text-xs">
                Immutable agent proof settlement & HTTP 402 payment protocol
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          {/* Network Status Card */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground">Network Status</span>
              <Badge variant="outline" className="gap-1.5 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[11px] font-semibold">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {network.toUpperCase()} CONNECTED
              </Badge>
            </div>

            <div className="flex items-center justify-between text-muted-foreground">
              <span>Algod Server Node</span>
              <span className="font-mono text-foreground">mainnet-api.algonode.cloud</span>
            </div>

            <div className="flex items-center justify-between text-muted-foreground">
              <span>Protocol Scheme</span>
              <span className="font-mono text-foreground">x402 Exact AVM (USDC/ALGO)</span>
            </div>
          </div>

          {/* Receiving Wallet Address Card */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground">Server Receiving Wallet Address</span>
              <Button variant="ghost" size="sm" onClick={copyAddress} className="h-7 px-2 text-xs gap-1">
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="font-mono text-[11px] break-all rounded-md bg-background/80 p-2 border border-border/40 text-foreground">
              {address}
            </div>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-0.5"
            >
              View account on Algorand Explorer (Lora) <ExternalLink className="size-3" />
            </a>
          </div>

          {/* x402 Endpoint for Hackathon Judges / Bots */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground">x402 Protected API Endpoint</span>
              <Button variant="ghost" size="sm" onClick={copyCurl} className="h-7 px-2 text-xs gap-1">
                {copiedCurl ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copiedCurl ? "Copied" : "Copy cURL"}
              </Button>
            </div>
            <div className="font-mono text-[11px] rounded-md bg-background/80 p-2 border border-border/40 text-foreground overflow-x-auto">
              {x402Endpoint}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Responds with <code className="text-foreground">HTTP 402 Payment Required</code> when unpaid, and verifies/settles signed Algorand transactions on-chain.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
