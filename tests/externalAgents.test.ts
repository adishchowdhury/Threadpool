import { test } from "node:test";
import assert from "node:assert/strict";
import { registerExternalAgentSchema, registerProviderSchema } from "@/lib/agents/externalSchemas";
import { validateExternalEndpoint } from "@/lib/agents/externalSecurity";
import { encryptSecret, decryptSecret } from "@/lib/agents/secrets";
import { scoreCandidates } from "@/lib/manager/scoring";
import type { DiscoverableAgent } from "@/lib/discovery/types";

// ── Registration validation ────────────────────────────────────────────

test("provider registration requires a name", () => {
  assert.equal(registerProviderSchema.safeParse({}).success, false);
  assert.equal(registerProviderSchema.safeParse({ name: "DeepResearch AI" }).success, true);
});

test("external agent registration rejects an unknown capability", () => {
  const base = { name: "DeepResearch", capabilities: ["market_research"], endpoint: "https://agent.example.com", price: 5 };
  assert.equal(registerExternalAgentSchema.safeParse(base).success, true);
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, capabilities: ["underwater_basket_weaving"] }).success, false);
});

test("external agent registration rejects a malformed endpoint", () => {
  const base = { name: "DeepResearch", capabilities: ["market_research"], price: 5 };
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, endpoint: "not-a-url" }).success, false);
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, endpoint: "https://agent.example.com" }).success, true);
});

test("external agent registration requires at least one capability and a positive price", () => {
  const base = { name: "DeepResearch", endpoint: "https://agent.example.com" };
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, capabilities: [], price: 5 }).success, false);
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, capabilities: ["market_research"], price: 0 }).success, false);
  assert.equal(registerExternalAgentSchema.safeParse({ ...base, capabilities: ["market_research"], price: -5 }).success, false);
});

// ── SSRF guard ──────────────────────────────────────────────────────────

test("validateExternalEndpoint requires https and rejects private/loopback hosts in production", () => {
  const prod = { isProduction: true };
  assert.equal(validateExternalEndpoint("https://agent.example.com", prod).valid, true);
  assert.equal(validateExternalEndpoint("http://agent.example.com", prod).valid, false);
  assert.equal(validateExternalEndpoint("https://localhost/health", prod).valid, false);
  assert.equal(validateExternalEndpoint("https://127.0.0.1/health", prod).valid, false);
  assert.equal(validateExternalEndpoint("https://10.0.0.5/health", prod).valid, false);
  assert.equal(validateExternalEndpoint("https://192.168.1.5/health", prod).valid, false);
  assert.equal(validateExternalEndpoint("https://169.254.169.254/health", prod).valid, false, "cloud metadata endpoint must be blocked");
});

test("validateExternalEndpoint allows http+loopback outside production (dev/demo), still rejects other private ranges", () => {
  const dev = { isProduction: false };
  assert.equal(validateExternalEndpoint("http://localhost:3000/api/demo-external-agent", dev).valid, true);
  assert.equal(validateExternalEndpoint("http://127.0.0.1:3000", dev).valid, true);
  assert.equal(validateExternalEndpoint("http://10.0.0.5", dev).valid, false);
  assert.equal(validateExternalEndpoint("http://192.168.1.5", dev).valid, false);
});

test("validateExternalEndpoint rejects non-http(s) protocols and malformed URLs", () => {
  assert.equal(validateExternalEndpoint("ftp://agent.example.com").valid, false);
  assert.equal(validateExternalEndpoint("not a url").valid, false);
});

// ── Secrets ─────────────────────────────────────────────────────────────

test("encryptSecret/decryptSecret round-trips and never stores the plaintext verbatim", () => {
  const plaintext = "super-secret-outbound-token";
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);
});

// ── Ranking: built-in + external compete on the same scoring ────────────

function makeAgent(overrides: Partial<DiscoverableAgent>): DiscoverableAgent {
  return {
    id: "a",
    name: "a",
    role: null,
    capabilities: ["market_research"],
    price: 5,
    endpoint: null,
    status: "ACTIVE",
    reputation: 50,
    successRate: 0.9,
    avgQuality: 85,
    avgLatencyMs: 10_000,
    avgCost: 5,
    totalJobs: 5,
    sampleCount: 5,
    isExternal: false,
    providerId: null,
    providerName: null,
    ...overrides,
  };
}

test("an external agent with better measured quality can outrank a built-in agent", () => {
  const builtIn = makeAgent({ id: "builtin", name: "Atlas", avgQuality: 80, successRate: 0.85, reputation: 80 });
  const external = makeAgent({
    id: "ext",
    name: "DeepResearch",
    isExternal: true,
    providerId: "prov-1",
    providerName: "DeepResearch AI",
    avgQuality: 94,
    successRate: 0.97,
    reputation: 94,
  });
  const ranked = scoreCandidates({ candidates: [builtIn, external], prices: new Map(), requiredCapability: "market_research", history: new Map() }).sort(
    (a, b) => b.totalScore - a.totalScore,
  );
  assert.equal(ranked[0].agent.id, "ext");
});

test("a cheap, unproven external agent does not automatically beat an established built-in agent (cold start)", () => {
  const established = makeAgent({ id: "builtin", name: "Atlas", avgQuality: 90, successRate: 0.95, reputation: 90, sampleCount: 50 });
  const newExternal = makeAgent({
    id: "ext",
    name: "Newcomer",
    isExternal: true,
    avgQuality: 100,
    successRate: 1,
    reputation: 100,
    sampleCount: 0, // no measured history yet - scoring.ts shrinks toward the pool prior
  });
  const ranked = scoreCandidates({ candidates: [established, newExternal], prices: new Map(), requiredCapability: "market_research", history: new Map() }).sort(
    (a, b) => b.totalScore - a.totalScore,
  );
  // The newcomer's claimed stats are fully shrunk toward the pool prior (built-in's numbers)
  // since it has zero samples - it should not blow past the established agent purely on
  // unverified claims, even though it's cheaper.
  assert.ok(ranked[0].totalScore - ranked[1].totalScore < 5, "cold-start agent should not dominate purely on unproven claims");
});
