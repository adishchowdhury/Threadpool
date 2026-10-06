import crypto from "node:crypto";

// Verifies a Firebase ID token server-side WITHOUT the firebase-admin SDK
// (which needs a service-account credential this project doesn't have
// configured) - Firebase ID tokens are standard RS256 JWTs signed by
// Google, so they can be verified with just the project id (already public,
// NEXT_PUBLIC_FIREBASE_PROJECT_ID) and Google's published public certs.
// This is the one place in the codebase that does real server-side identity
// verification - everything else (task creation) only gates client-side.

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CERT_CACHE_MS = 60 * 60 * 1000; // Google rotates these infrequently; re-fetch hourly or on a kid miss.

let certCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

async function getCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && certCache && Date.now() - certCache.fetchedAt < CERT_CACHE_MS) {
    return certCache.certs;
  }
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`could not fetch Firebase signing certs (HTTP ${res.status})`);
  const certs = (await res.json()) as Record<string, string>;
  certCache = { certs, fetchedAt: Date.now() };
  return certs;
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  name: string | null;
}

// `overrides` exists so tests can exercise the real signature-verification
// and claim-validation logic end-to-end against a locally generated
// keypair, without reaching Google's network endpoint. Production call
// sites never pass it.
export async function verifyFirebaseIdToken(
  idToken: string,
  overrides?: { certs?: Record<string, string>; projectId?: string; nowMs?: number },
): Promise<VerifiedFirebaseUser | null> {
  const projectId = overrides?.projectId ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  let certs = overrides?.certs ?? (await getCerts());
  let cert = certs[header.kid];
  if (!cert && !overrides?.certs) {
    // The key we need isn't in our cached set - refresh once before giving up.
    certs = await getCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) return null;

  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`),
    crypto.createPublicKey(cert),
    base64UrlDecode(signatureB64),
  );
  if (!verified) return null;

  const nowSec = (overrides?.nowMs ?? Date.now()) / 1000;
  const LEEWAY_SEC = 60;
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_SEC < nowSec) return null;
  if (typeof payload.iat !== "number" || payload.iat - LEEWAY_SEC > nowSec) return null;
  if (payload.aud !== projectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
