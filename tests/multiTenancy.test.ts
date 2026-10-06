import { test } from "node:test";
import assert from "node:assert/strict";
import { roleAtLeast, evaluateMembership } from "@/lib/auth/rbac";

// Pure RBAC/isolation decision logic - no DB, mirroring the style of
// circuitBreaker.ts/credentials.ts, so cross-tenant isolation and role
// gating are provable without a live database (this repo deliberately
// keeps `npm test` DB-free per CLAUDE.md §14).

test("roleAtLeast ranks OWNER > ADMIN > OPERATOR > VIEWER", () => {
  assert.equal(roleAtLeast("OWNER", "VIEWER"), true);
  assert.equal(roleAtLeast("OWNER", "OWNER"), true);
  assert.equal(roleAtLeast("VIEWER", "OWNER"), false);
  assert.equal(roleAtLeast("ADMIN", "OPERATOR"), true);
  assert.equal(roleAtLeast("OPERATOR", "ADMIN"), false);
  assert.equal(roleAtLeast("VIEWER", "VIEWER"), true);
});

test("evaluateMembership denies a non-member of an existing org - this is the cross-tenant isolation boundary", () => {
  const decision = evaluateMembership({ organizationExists: true, membership: null, minRole: "VIEWER" });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.status, 404);
});

test("evaluateMembership denies an unknown organization with the SAME shape as a non-member (no existence leak)", () => {
  const unknownOrg = evaluateMembership({ organizationExists: false, membership: null, minRole: "VIEWER" });
  const notAMember = evaluateMembership({ organizationExists: true, membership: null, minRole: "VIEWER" });
  assert.deepEqual(unknownOrg, notAMember, "a probing non-member must not be able to tell org-doesn't-exist from not-a-member");
});

test("evaluateMembership allows a member whose role meets the minimum", () => {
  const decision = evaluateMembership({ organizationExists: true, membership: { role: "ADMIN" }, minRole: "OPERATOR" });
  assert.equal(decision.allowed, true);
  if (decision.allowed) assert.equal(decision.role, "ADMIN");
});

test("evaluateMembership denies a member whose role is below the minimum, with 403 (not 404)", () => {
  const decision = evaluateMembership({ organizationExists: true, membership: { role: "VIEWER" }, minRole: "ADMIN" });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.status, 403);
});

test("OWNER clears every role gate; VIEWER clears only VIEWER", () => {
  for (const min of ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const) {
    assert.equal(evaluateMembership({ organizationExists: true, membership: { role: "OWNER" }, minRole: min }).allowed, true);
  }
  assert.equal(evaluateMembership({ organizationExists: true, membership: { role: "VIEWER" }, minRole: "VIEWER" }).allowed, true);
  assert.equal(evaluateMembership({ organizationExists: true, membership: { role: "VIEWER" }, minRole: "OPERATOR" }).allowed, false);
});
