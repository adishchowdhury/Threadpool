import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { getX402ResourceServer, X402_ALGORAND_NETWORK, getX402PayToAddress } from "@/lib/blockchain/x402Algorand";

const RESOURCE_PATH = "/api/x402/premium-market-research";

/**
 * Real, x402-protocol-compliant premium resource: GET is protected by
 * withX402 (from the official @x402/next package), which returns a proper
 * HTTP 402 with payment requirements when unpaid, verifies the caller's
 * signed Algorand USDC payment (AVM "exact" scheme) against the configured
 * facilitator, and only then invokes this handler. Settlement (the actual
 * on-chain submission) happens after this handler returns a successful
 * response, and only then.
 *
 * Query params are used instead of a JSON body because the x402 SDK may
 * consume the request body while parsing payment context before this
 * handler runs.
 */
async function handler(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query") || "fintech market";
  const depth = request.nextUrl.searchParams.get("depth") || "premium";

  const premiumData = {
    query,
    depth,
    timestamp: new Date().toISOString(),
    source: "Premium ALGORAND-Paid x402 Service (real settlement)",
    paymentVerified: true,
    result: `Premium intelligence report on: "${query}". Major tailwinds include emerging digital assets regulations, expansion of cross-border micro-transactions, and increased institutional adoption of zero-knowledge smart-contracts. Growth trajectory exhibits a CAGR of 24.5% over the next 5 years.`,
  };

  return NextResponse.json(premiumData);
}

export const GET = withX402(
  handler,
  {
    accepts: {
      scheme: "exact",
      payTo: getX402PayToAddress(),
      price: "$0.01",
      network: X402_ALGORAND_NETWORK,
    },
    resource: RESOURCE_PATH,
    description: "Premium Market Intelligence Service",
    mimeType: "application/json",
  },
  getX402ResourceServer(),
);
