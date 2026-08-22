import algosdk from "algosdk";

const ALGOD_SERVER = process.env.ALGOD_SERVER || "https://testnet-api.algonode.cloud";
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || "";
const ALGOD_PORT = process.env.ALGOD_PORT || "";
export const ALGOD_NETWORK = process.env.ALGOD_NETWORK || "testnet";

const MNEMONIC = process.env.ALGOD_MNEMONIC || process.env.MANAGER_MNEMONIC || "";

let cachedClient: algosdk.Algodv2 | null = null;
function getAlgodClient(): algosdk.Algodv2 {
  if (!cachedClient) {
    cachedClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
  }
  return cachedClient;
}

let cachedAccount: algosdk.Account | null = null;
function getManagerAccount(): algosdk.Account | null {
  if (cachedAccount) return cachedAccount;
  if (!MNEMONIC || MNEMONIC === "mock") return null;
  try {
    cachedAccount = algosdk.mnemonicToSecretKey(MNEMONIC.replace(/"/g, ""));
    return cachedAccount;
  } catch {
    return null;
  }
}

export function isRealAlgorandConfigured(): boolean {
  return getManagerAccount() !== null;
}

export function getManagerAlgorandAddress(): string | null {
  const account = getManagerAccount();
  return account ? account.addr.toString() : null;
}

/**
 * Submits a real, zero-value self-payment transaction on Algorand testnet
 * carrying `note` as its note field, and waits for confirmation. Used to
 * anchor proof hashes / off-chain transfer metadata on-chain so every entry
 * shown in the UI corresponds to a genuine, explorer-verifiable transaction.
 * The internal ledger/DB remains the authoritative record of who-owes-whom;
 * this only produces an immutable, timestamped receipt for it.
 */
export async function submitAnchorTransaction(
  note: Record<string, unknown>,
): Promise<{ txId: string; confirmedRound: number; senderAddress: string }> {
  const account = getManagerAccount();
  if (!account) {
    throw new Error("Algorand signing account not configured (ALGOD_MNEMONIC missing)");
  }

  const client = getAlgodClient();
  const suggestedParams = await client.getTransactionParams().do();

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: account.addr,
    amount: 0,
    note: new TextEncoder().encode(JSON.stringify(note)),
    suggestedParams,
  });

  const signedTxn = txn.signTxn(account.sk);
  const { txid } = await client.sendRawTransaction(signedTxn).do();

  const confirmed = await algosdk.waitForConfirmation(client, txid, 6);

  return {
    txId: txid,
    confirmedRound: Number(confirmed.confirmedRound ?? BigInt(0)),
    senderAddress: account.addr.toString(),
  };
}

export function getExplorerTxUrl(txId: string): string {
  return `https://lora.algokit.io/${ALGOD_NETWORK}/transaction/${txId}`;
}

export function getExplorerAccountUrl(address: string): string {
  return `https://lora.algokit.io/${ALGOD_NETWORK}/account/${address}`;
}
