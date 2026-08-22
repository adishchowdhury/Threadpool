import { NextResponse } from "next/server";
import {
  decodeHeaderPayload,
  encodeHeaderPayload,
  PaymentRequiredPayload,
  PaymentResponsePayload,
  PaymentSignaturePayload,
} from "@/lib/blockchain/x402";
import { verifyEthereumTransaction, getServiceAddress } from "@/lib/blockchain/ethereum";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, depth, taskId, agentId, idempotencyKey } = body;

    const signatureHeader = request.headers.get("PAYMENT-SIGNATURE");

    const serviceAddress = getServiceAddress();
    const requiredAmountWei = 1000; // 1000 Wei / 1.00 token equivalent for demo

    // 1. If PAYMENT-SIGNATURE is missing, return 402 Payment Required
    if (!signatureHeader) {
      const requiredPayload: PaymentRequiredPayload = {
        x402Version: 2,
        error: "Payment required",
        resource: {
          url: "POST /api/x402/premium-market-research",
          description: "Premium Market Intelligence Service",
        },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:11155111", // Ethereum Sepolia
            amount: requiredAmountWei.toString(),
            asset: "ETH",
            payTo: serviceAddress,
          },
        ],
      };

      const headers = new Headers();
      headers.set("PAYMENT-REQUIRED", encodeHeaderPayload(requiredPayload));
      headers.set("Access-Control-Expose-Headers", "PAYMENT-REQUIRED");

      return NextResponse.json(
        { error: "Payment Required to access Premium Market Research" },
        { status: 402, headers }
      );
    }

    // 2. Parse and verify payment signature
    let signature: PaymentSignaturePayload;
    try {
      signature = decodeHeaderPayload<PaymentSignaturePayload>(signatureHeader);
    } catch (err) {
      return NextResponse.json({ error: "Invalid PAYMENT-SIGNATURE header format" }, { status: 400 });
    }

    const verification = await verifyEthereumTransaction(
      signature.transaction,
      requiredAmountWei,
      serviceAddress
    );

    if (!verification.success) {
      return NextResponse.json({ error: `Payment verification failed: ${verification.error}` }, { status: 402 });
    }

    // 3. Payment is verified, return results and PAYMENT-RESPONSE header
    const responsePayload: PaymentResponsePayload = {
      success: true,
      network: signature.network,
      transaction: signature.transaction,
    };

    const headers = new Headers();
    headers.set("PAYMENT-RESPONSE", encodeHeaderPayload(responsePayload));
    headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE");

    // Realistic premium market analysis output
    const premiumData = {
      query,
      depth,
      timestamp: new Date().toISOString(),
      source: "Premium Ethereum-Paid x402 Service",
      paymentVerified: true,
      transactionId: signature.transaction,
      result: `Premium intelligence report on: "${query}". Major tailwinds include emerging digital assets regulations, expansion of cross-border micro-transactions, and increased institutional adoption of zero-knowledge smart-contracts. Growth trajectory exhibits a CAGR of 24.5% over the next 5 years. Paid settlement verified on Ethereum Sepolia (${signature.network}).`,
    };

    return NextResponse.json(premiumData, { status: 200, headers });
  } catch (error: any) {
    console.error("[Premium Service Error]", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
