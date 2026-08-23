import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getX402ResourceServer, X402_ALGORAND_NETWORK, getX402PayToAddress } from "@/lib/blockchain/x402Algorand";

const RESOURCE_PATH = "/api/x402/ledger-mirror";
// Demo exchange rate shared with lib/blockchain/algorand.ts's mirrorTransaction
// and lib/manager/worker.ts's premium-research flow: 1 virtual task-budget
// token == $0.01 real testnet USDC.
const USD_PER_TOKEN = 0.01;

/**
 * Real x402-protected resource that internal ledger mirrors (escrow lock,
 * agent payout, refund — see lib/economy/escrow.ts) pay for, replacing the
 * old 0-ALGO self-payment "ledger_mirror" note. withX402 (the official
 * @x402/next package) returns a genuine HTTP 402 with payment requirements,
 * verifies the caller's signed Algorand USDC payment against the configured
 * facilitator, and only then invokes this handler; settlement happens after
 * the handler returns 200. The price scales with the mirrored token amount
 * via a dynamic price callback.
 */
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
    },
    resource: RESOURCE_PATH,
    description: "Internal ledger mirror settlement (escrow lock / payout / refund)",
    mimeType: "application/json",
  },
  getX402ResourceServer(),
);
