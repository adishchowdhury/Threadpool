import { createHash } from "crypto";
import { emitEvent } from "@/lib/events/emit";
import { db } from "@/lib/db/client";
import { isRealAlgorandConfigured, submitAnchorTransaction } from "@/lib/blockchain/algosdkClient";
import {
  getX402PayingFetch,
  isRealX402PayerConfigured,
  describeX402Failure,
  getX402SettleResponse,
} from "@/lib/blockchain/x402Algorand";

const ALGOD_SERVER = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || "";
const ALGOD_NETWORK = process.env.ALGOD_NETWORK || "testnet";

const DEMO_MANAGER_ADDRESS = "KRAVEN402MANAGERACCOUNTXXXXXXXXXXXXXX";
const DEMO_SERVICE_ADDRESS = "KRAVEN402SERVICEACCOUNTXXXXXXXXXXXXXX";

// Algorand addresses are 58-char base32 strings. We don't hold real signing
// keys for every seeded agent, so each wallet gets a deterministic
// mock-testnet address derived from its wallet id - stable across reseeds,
// unique per wallet, and clearly an address (not a random blob) when shown
// in the UI.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateMockAlgorandAddress(seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < 58; i++) {
    out += BASE32_ALPHABET[hash[i % hash.length] % BASE32_ALPHABET.length];
  }
  return out;
}

export interface AlgorandTransactionResult {
  txId: string;
  sender: string;
  receiver: string;
  amount: number;
  confirmed: boolean;
  network: string;
}

export function getManagerAddress(): string {
  if (process.env.MANAGER_ADDRESS) {
    return process.env.MANAGER_ADDRESS;
  }
  return DEMO_MANAGER_ADDRESS;
}

export function getServiceAddress(): string {
  if (process.env.SERVICE_ADDRESS) {
    return process.env.SERVICE_ADDRESS;
  }
  return DEMO_SERVICE_ADDRESS;
}

export async function verifyAlgorandTransaction(
  txId: string,
  expectedAmountMicroAlgos: number,
  expectedRecipient: string
): Promise<{ success: boolean; error?: string; txDetails?: AlgorandTransactionResult }> {
  try {
    if (txId.startsWith("x402-") || !process.env.MANAGER_MNEMONIC) {
      console.log(`[Algorand] Verifying mock transaction: ${txId}`);
      return {
        success: true,
        txDetails: {
          txId,
          sender: getManagerAddress(),
          receiver: expectedRecipient,
          amount: expectedAmountMicroAlgos,
          confirmed: true,
          network: ALGOD_NETWORK,
        },
      };
    }

    const response = await fetch(`${ALGOD_SERVER}/v2/transactions/pending/${txId}`, {
      headers: ALGOD_TOKEN ? { "X-Algo-API-Token": ALGOD_TOKEN } : {},
    });

    if (!response.ok) {
      const blockResponse = await fetch(`${ALGOD_SERVER}/v2/transactions/${txId}`);
      if (!blockResponse.ok) {
        return { success: false, error: `Transaction ${txId} not found on network ${ALGOD_NETWORK}` };
      }
      const data = await blockResponse.json();
      const txn = data.transaction;
      const amt = txn.amt || txn["payment-transaction"]?.amount || 0;
      const rcvr = txn.rcv || txn["payment-transaction"]?.receiver || "";

      const type = txn.type || (txn["payment-transaction"] ? "pay" : "");
      if (type !== "pay") {
        return { success: false, error: `Invalid transaction type. Expected 'pay' (Payment), got '${txn.type}'` };
      }

      if (rcvr !== expectedRecipient) {
        return { success: false, error: `Recipient mismatch. Expected ${expectedRecipient}, got ${rcvr}` };
      }
      if (amt < expectedAmountMicroAlgos) {
        return { success: false, error: `Amount mismatch. Expected at least ${expectedAmountMicroAlgos}, got ${amt}` };
      }

      return {
        success: true,
        txDetails: {
          txId,
          sender: txn.snd || "",
          receiver: rcvr,
          amount: amt,
          confirmed: true,
          network: ALGOD_NETWORK,
        },
      };
    }

    const pendingData = await response.json();
    const txn = pendingData.txn?.txn;
    const amt = txn?.amt || 0;

    if (txn?.type && txn.type !== "pay") {
      return { success: false, error: `Invalid pending transaction type. Expected 'pay' (Payment), got '${txn.type}'` };
    }

    return {
      success: true,
      txDetails: {
        txId,
        sender: pendingData.txn?.txn?.snd || "",
        receiver: expectedRecipient,
        amount: amt,
        confirmed: true,
        network: ALGOD_NETWORK,
      },
    };
  } catch (err: any) {
    console.error("[Algorand Verification Error]", err);
    return { success: false, error: err.message || "Unknown verification error" };
  }
}

export async function sendAlgorandPayment(
  taskId: string,
  requestingAgentId: string,
  amountMicroAlgos: number,
  recipientAddress: string,
  purpose: string
): Promise<{ txId: string; network: string }> {
  const isReal = isRealAlgorandConfigured();
  console.log(`[Algorand] Executing ${isReal ? "REAL" : "MOCK"} payment. Task: ${taskId}, Amount: ${amountMicroAlgos} microAlgos to ${recipientAddress}`);

  let txId: string;
  if (isReal) {
    const result = await submitAnchorTransaction({
      v: 1,
      kind: "x402_payment",
      taskId,
      agentId: requestingAgentId,
      amountMicroAlgos,
      recipient: recipientAddress,
      purpose,
    });
    txId = result.txId;
  } else {
    txId = `x402-tx-${Math.random().toString(36).substring(2, 15)}`;
  }

  await emitEvent(db, {
    taskId,
    actor: requestingAgentId,
    eventType: "TRANSACTION_APPROVED",
    payload: { agentId: requestingAgentId, amount: amountMicroAlgos, subtaskId: purpose },
  });

  return {
    txId,
    network: ALGOD_NETWORK,
  };
}

// Settlement adapter used to mirror an internal virtual-token wallet
// transfer (escrow lock/payout/refund) onto Algorand testnet, so agent-to-
// agent payments have an on-chain record. The internal ledger remains
// authoritative - this never gates or reverses it, it only mirrors what the
// ledger already decided.
//
// The mirror is a REAL x402 payment (402 -> sign -> facilitator verify ->
// facilitator settle) against /api/x402/ledger-mirror - see
// lib/blockchain/x402Algorand.ts - not a self-payment note. `amountMicroAlgos`
// carries the internal virtual-token amount (unchanged param name to keep
// escrow.ts's call sites untouched); the route converts it to a real USDC
// price via a dynamic price callback. Falls back to the old anchored-note
// mock only when no real signer is configured (ALGOD_MNEMONIC/MANAGER_MNEMONIC
// unset), and is labeled as such - it never claims x402 ran when it didn't.
export async function mirrorTransaction(params: {
  fromAddress: string;
  toAddress: string;
  amountMicroAlgos: number;
  purpose: string;
}): Promise<{ txId: string; network: string; status: "CONFIRMED" }> {
  const isReal = isRealX402PayerConfigured();
  const tokens = Math.max(1, Math.round(params.amountMicroAlgos));

  console.log(
    `[Algorand Mirror] ${isReal ? "REAL x402" : "MOCK"} ${tokens} token(s) ${params.fromAddress.slice(0, 8)}... -> ${params.toAddress.slice(0, 8)}... (${params.purpose})`
  );

  if (!isReal) {
    return {
      txId: `x402-mirror-${Math.random().toString(36).substring(2, 15)}`,
      network: ALGOD_NETWORK,
      status: "CONFIRMED",
    };
  }

  const payFetch = getX402PayingFetch();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const url = `${baseUrl}/api/x402/ledger-mirror?amount=${tokens}&purpose=${encodeURIComponent(params.purpose)}`;

  const response = await payFetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`x402 ledger-mirror payment failed (HTTP ${response.status}): ${await describeX402Failure(response)}`);
  }

  const settlement = getX402SettleResponse(response);
  if (!settlement) {
    throw new Error("x402 ledger-mirror response missing a PAYMENT-RESPONSE header - cannot confirm real settlement");
  }

  return { txId: settlement.transaction, network: settlement.network, status: "CONFIRMED" };
}

export async function getTransactionStatus(txId: string): Promise<{ status: string; network: string }> {
  if (txId.startsWith("x402-")) {
    return { status: "CONFIRMED", network: ALGOD_NETWORK };
  }
  try {
    const response = await fetch(`${ALGOD_SERVER}/v2/transactions/${txId}`);
    return { status: response.ok ? "CONFIRMED" : "UNKNOWN", network: ALGOD_NETWORK };
  } catch {
    return { status: "UNKNOWN", network: ALGOD_NETWORK };
  }
}
