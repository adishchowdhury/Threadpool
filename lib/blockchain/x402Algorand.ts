import algosdk from "algosdk";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme as ExactAvmSchemeServer } from "@x402/avm/exact/server";
import { ExactAvmScheme as ExactAvmSchemeClient } from "@x402/avm/exact/client";
import {
  ALGORAND_TESTNET_GENESIS_HASH,
  ALGORAND_MAINNET_GENESIS_HASH,
  toClientAvmSigner,
} from "@x402/avm";

/**
 * Real x402 payment protocol wiring for Algorand, using the official
 * @x402/core + @x402/avm + @x402/next + @x402/fetch packages (x402 Foundation,
 * https://github.com/x402-foundation/x402) instead of a custom header scheme.
 *
 * The AVM "exact" scheme pays via an Algorand Standard Asset transfer (USDC by
 * default) inside an atomic group - never a native-ALGO self-payment. Verify
 * and settle are delegated to a real x402 facilitator over HTTP; this app never
 * signs the facilitator's own fee-payer leg.
 */

// The hosted GoPlausible facilitator (and the AVM exact scheme's own
// route-support check) matches network ids by exact string, so this must be
// the full-genesis-hash CAIP-2 form the facilitator actually advertises via
// GET /supported - not @x402/avm's shorter ALGORAND_TESTNET_CAIP2 constant,
// which that facilitator does not list as supported.
export const X402_ALGORAND_NETWORK =
  process.env.ALGOD_NETWORK === "mainnet"
    ? `algorand:${ALGORAND_MAINNET_GENESIS_HASH}`
    : `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.goplausible.xyz";

let cachedFacilitator: HTTPFacilitatorClient | null = null;
function getFacilitatorClient(): HTTPFacilitatorClient {
  if (!cachedFacilitator) {
    cachedFacilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  }
  return cachedFacilitator;
}

let cachedResourceServer: x402ResourceServer | null = null;
/** Server-side x402 resource server: verifies/settles via the real facilitator. */
export function getX402ResourceServer(): x402ResourceServer {
  if (!cachedResourceServer) {
    cachedResourceServer = new x402ResourceServer(getFacilitatorClient()).register(
      X402_ALGORAND_NETWORK,
      new ExactAvmSchemeServer(),
    );
  }
  return cachedResourceServer;
}

function getManagerAccount(): algosdk.Account | null {
  const mnemonic = process.env.ALGOD_MNEMONIC || process.env.MANAGER_MNEMONIC;
  if (!mnemonic) return null;
  try {
    return algosdk.mnemonicToSecretKey(mnemonic.replace(/"/g, ""));
  } catch {
    return null;
  }
}

export function isRealX402PayerConfigured(): boolean {
  return getManagerAccount() !== null;
}

/**
 * Resolves the receiving address for the x402-protected route. Falls back to
 * the same funded manager account used to pay (a self-pay demo) when no
 * distinct SERVICE_ADDRESS is configured - still a real signed ASA transfer
 * and a real on-chain settlement, just payer and payee coincide.
 */
export function getX402PayToAddress(): string {
  if (process.env.SERVICE_ADDRESS && algosdk.isValidAddress(process.env.SERVICE_ADDRESS)) {
    return process.env.SERVICE_ADDRESS;
  }
  const account = getManagerAccount();
  if (account) return account.addr.toString();
  throw new Error("No Algorand payTo address configured (set SERVICE_ADDRESS, or ALGOD_MNEMONIC/MANAGER_MNEMONIC)");
}

/**
 * Extracts the real reason a paid x402 request failed. On a failed retry the
 * response body is typically `{}` (this app doesn't customize
 * unpaidResponseBody) - the actual reason (e.g. the facilitator's simulation
 * error) lives in the base64-encoded `payment-required` / `PAYMENT-REQUIRED`
 * response header, per the x402 spec. Falls back to the raw body text.
 */
export async function describeX402Failure(response: Response): Promise<string> {
  const paymentRequiredHeader = response.headers.get("payment-required") || response.headers.get("PAYMENT-REQUIRED");
  if (paymentRequiredHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")) as {
        error?: string;
      };
      if (decoded.error) return decoded.error;
    } catch {
      // fall through to raw body below
    }
  }
  return (await response.text()) || `HTTP ${response.status}`;
}

/**
 * Reads the real settlement receipt off a successful paid x402 response.
 * This SDK version names the header `PAYMENT-RESPONSE` (not the
 * `X-PAYMENT-RESPONSE` name used elsewhere in the x402 ecosystem/spec drafts)
 * - confirmed against a live settled response during implementation - so both
 * are checked here for robustness across facilitator/SDK versions.
 */
export function getX402SettleResponse(
  response: Response,
): { success: boolean; transaction: string; network: string; payer?: string; amount?: string } | null {
  const header = response.headers.get("PAYMENT-RESPONSE") || response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

let cachedPayingFetch: typeof fetch | null = null;
/**
 * Client-side payment-aware fetch: on a 402, signs a real ASA transfer with
 * the manager account's key and retries with the X-PAYMENT header, per the
 * x402 protocol (see @x402/fetch's wrapFetchWithPayment).
 */
export function getX402PayingFetch(): typeof fetch {
  if (cachedPayingFetch) return cachedPayingFetch;
  const account = getManagerAccount();
  if (!account) {
    throw new Error("ALGOD_MNEMONIC/MANAGER_MNEMONIC not configured - cannot sign real x402 Algorand payments");
  }
  // ClientAvmSigner expects a base64 64-byte key (32-byte seed + 32-byte public
  // key); algosdk's Account.sk is exactly that nacl secret-key format.
  const secretKeyBase64 = Buffer.from(account.sk).toString("base64");
  const signer = toClientAvmSigner(secretKeyBase64);
  const client = new x402Client().register(X402_ALGORAND_NETWORK, new ExactAvmSchemeClient(signer));
  cachedPayingFetch = wrapFetchWithPayment(fetch, client);
  return cachedPayingFetch;
}
