import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions";
import { getX402ResourceServer, X402_ALGORAND_NETWORK, getX402PayToAddress } from "@/lib/blockchain/x402Algorand";

const RESOURCE_PATH = "/api/x402/premium-market-research";

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
      extra: {
        tag: "x402-global-challenge",
      },
    },
    resource: RESOURCE_PATH,
    description: "Premium Market Intelligence Service",
    mimeType: "application/json",
    extensions: declareDiscoveryExtension({}),
  },
  getX402ResourceServer(),
);
