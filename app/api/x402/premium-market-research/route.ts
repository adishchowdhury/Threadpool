import { NextResponse } from "next/server";
import {
  decodeHeaderPayload,
  encodeHeaderPayload,
  PaymentRequiredPayload,
  PaymentResponsePayload,
  PaymentSignaturePayload,
} from "@/lib/blockchain/x402";
import * as eth from "@/lib/blockchain/ethereum";
import * as algo from "@/lib/blockchain/algorand";

function getProvider() {
  return process.env.BLOCKCHAIN_PROVIDER === "algorand" ? "algorand" : "ethereum";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, depth, taskId, agentId, idempotencyKey } = body;

    const signatureHeader = request.headers.get("PAYMENT-SIGNATURE");
    const provider = getProvider();

    const serviceAddress = provider === "algorand" ? algo.getServiceAddress() : eth.getServiceAddress();
    const requiredAmount = 1000; // 1000 Wei or MicroAlgos / 1.00 token equivalent for demo

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
            network: provider === "algorand" ? "algorand:testnet" : "eip155:11155111",
            amount: requiredAmount.toString(),
            asset: provider === "algorand" ? "ALGO" : "ETH",
            payTo: serviceAddress,
          },
        ],
      };

      const headers = new Headers();
      headers.set("PAYMENT-REQUIRED", encodeHeaderPayload(requiredPayload));
      headers.set("Access-Control-Expose-Headers", "PAYMENT-REQUIRED");

      return NextResponse.json(
        { error: `Payment Required to access Premium Market Research via ${provider.toUpperCase()}` },
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

    let verificationSuccess = false;
    let verificationError = "";

    if (provider === "algorand") {
      const verification = await algo.verifyAlgorandTransaction(
        signature.transaction,
        requiredAmount,
        serviceAddress
      );
      verificationSuccess = verification.success;
      verificationError = verification.error || "";
    } else {
      const verification = await eth.verifyEthereumTransaction(
        signature.transaction,
        requiredAmount,
        serviceAddress
      );
      verificationSuccess = verification.success;
      verificationError = verification.error || "";
    }

    if (!verificationSuccess) {
      return NextResponse.json({ error: `Payment verification failed: ${verificationError}` }, { status: 402 });
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

    const premiumData = {
      query,
      depth,
      timestamp: new Date().toISOString(),
      source: `Premium ${provider.toUpperCase()}-Paid x402 Service`,
      paymentVerified: true,
      transactionId: signature.transaction,
      result: `Premium intelligence report on: "${query}". Major tailwinds include emerging digital assets regulations, expansion of cross-border micro-transactions, and increased institutional adoption of zero-knowledge smart-contracts. Growth trajectory exhibits a CAGR of 24.5% over the next 5 years. Paid settlement verified on ${provider.toUpperCase()} (${signature.network}).`,
    };

    return NextResponse.json(premiumData, { status: 200, headers });
  } catch (error: any) {
    console.error("[Premium Service Error]", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
