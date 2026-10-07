import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions";
import { getX402ResourceServer, X402_ALGORAND_NETWORK, getX402PayToAddress } from "@/lib/blockchain/x402Algorand";

const RESOURCE_PATH = "/api/x402/ledger-mirror";
const USD_PER_TOKEN = 0.01;

async function handler(request: NextRequest) {
  return NextResponse.json({
    mirrored: true,
    purpose: request.nextUrl.searchParams.get("purpose") || "ledger_mirror",
    timestamp: new Date().toISOString(),
  });
}

export const GET = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      payTo: getX402PayToAddress(),
      price: (context) => {
        const raw = context.adapter.getQueryParam?.("amount");
        const amountParam = Array.isArray(raw) ? raw[0] : raw;
        const tokens = Math.max(1, Math.round(Number(amountParam) || 1));
        return `$${(tokens * USD_PER_TOKEN).toFixed(2)}`;
      },
      network: X402_ALGORAND_NETWORK,
      extra: {
        tag: "x402-global-challenge",
      },
    },
    resource: RESOURCE_PATH,
    description: "Internal ledger mirror settlement (escrow lock / payout / refund)",
    mimeType: "application/json",
    extensions: declareDiscoveryExtension({}),
  },
  getX402ResourceServer(),
);
