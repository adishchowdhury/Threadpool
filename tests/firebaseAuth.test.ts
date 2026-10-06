import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyFirebaseIdToken } from "@/lib/auth/firebaseVerify";

// Exercises the REAL RS256 signature verification + claim validation in
// lib/auth/firebaseVerify.ts (the one genuine server-side identity check in
// this codebase) against a locally generated keypair - not mocked away.
// Only the network cert fetch is swapped out (via `overrides`), since that
// call reaches Google's real infrastructure.

const PROJECT_ID = "test-project-id";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload: Record<string, unknown>, privateKey: crypto.KeyObject, kid = "test-kid", alg = "RS256"): string {
  const header = { alg, kid, typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { publicKey, privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

function basePayload(nowSec: number) {
  return {
    sub: "user-123",
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    iat: nowSec - 10,
    exp: nowSec + 3600,
    email: "demo@example.com",
    name: "Demo User",
  };
}

test("accepts a validly signed, validly claimed token", async () => {
  const { privateKey, publicPem } = makeKeypair();
  const now = Date.now();
  const token = signToken(basePayload(now / 1000), privateKey);
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": publicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.ok(result);
  assert.equal(result?.uid, "user-123");
  assert.equal(result?.email, "demo@example.com");
});

test("rejects a token signed with the wrong key (forged signature)", async () => {
  const { privateKey: wrongKey } = makeKeypair();
  const { publicPem: realPublicPem } = makeKeypair();
  const now = Date.now();
  const token = signToken(basePayload(now / 1000), wrongKey);
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": realPublicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.equal(result, null);
});

test("rejects an expired token", async () => {
  const { privateKey, publicPem } = makeKeypair();
  const now = Date.now();
  const payload = { ...basePayload(now / 1000), exp: now / 1000 - 1000 };
  const token = signToken(payload, privateKey);
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": publicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.equal(result, null);
});

test("rejects a token with the wrong audience (a different Firebase project)", async () => {
  const { privateKey, publicPem } = makeKeypair();
  const now = Date.now();
  const payload = { ...basePayload(now / 1000), aud: "some-other-project" };
  const token = signToken(payload, privateKey);
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": publicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.equal(result, null);
});

test("rejects a token with the wrong issuer", async () => {
  const { privateKey, publicPem } = makeKeypair();
  const now = Date.now();
  const payload = { ...basePayload(now / 1000), iss: "https://attacker.example.com" };
  const token = signToken(payload, privateKey);
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": publicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.equal(result, null);
});

test("rejects a non-RS256 token outright (alg confusion attempt)", async () => {
  const { privateKey, publicPem } = makeKeypair();
  const now = Date.now();
  const token = signToken(basePayload(now / 1000), privateKey, "test-kid", "none");
  const result = await verifyFirebaseIdToken(token, { certs: { "test-kid": publicPem }, projectId: PROJECT_ID, nowMs: now });
  assert.equal(result, null);
});

test("rejects a malformed token", async () => {
  assert.equal(await verifyFirebaseIdToken("not-a-jwt"), null);
  assert.equal(await verifyFirebaseIdToken("a.b"), null);
});

test("returns null (not a crash) when no Firebase project id is configured anywhere", async () => {
  // "" (not undefined) forces the no-project-configured branch regardless of
  // whatever NEXT_PUBLIC_FIREBASE_PROJECT_ID happens to be in this process's
  // env (other test files transitively load .env via dotenv/config).
  const result = await verifyFirebaseIdToken("anything", { projectId: "", certs: {} });
  assert.equal(result, null);
});
