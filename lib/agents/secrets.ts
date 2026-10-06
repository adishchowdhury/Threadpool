import crypto from "node:crypto";

// Encrypts the outbound auth token a provider supplies (the secret Kraven
// sends TO their endpoint). This is provider-supplied, not Kraven-issued, so
// Kraven needs the plaintext back - it's encrypted at rest (not hashed) with
// a server-only key.
//
// Known limitation: if KRAVEN_SECRETS_KEY is unset, an ephemeral per-process
// key is generated instead of refusing to start. That key does not survive a
// restart, so every external agent would need its secret re-entered after a
// redeploy. Set KRAVEN_SECRETS_KEY (32 bytes, base64 or hex) in production.
const ALGORITHM = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = process.env.KRAVEN_SECRETS_KEY;
  if (configured) {
    const buf = /^[0-9a-f]+$/i.test(configured) && configured.length === 64
      ? Buffer.from(configured, "hex")
      : Buffer.from(configured, "base64");
    if (buf.length !== 32) {
      throw new Error("KRAVEN_SECRETS_KEY must decode to exactly 32 bytes (hex or base64)");
    }
    cachedKey = buf;
    return cachedKey;
  }

  console.warn(
    "[secrets] KRAVEN_SECRETS_KEY is not set - using an ephemeral in-process key. " +
      "External agent auth secrets will NOT survive a restart. Set KRAVEN_SECRETS_KEY in production.",
  );
  cachedKey = crypto.randomBytes(32);
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted secret");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

// Every route that returns an Agent document to any client must strip this
// first - the encrypted secret is write-only from the API's perspective.
export function withoutExternalSecret<T extends { externalAuthSecretEncrypted?: unknown }>(agent: T): Omit<T, "externalAuthSecretEncrypted"> {
  const copy: Partial<T> = { ...agent };
  delete copy.externalAuthSecretEncrypted;
  return copy as Omit<T, "externalAuthSecretEncrypted">;
}
