import { db } from "@/lib/db/client";
import { resolveSessionUser, type SessionUser } from "@/lib/auth/session";
import type { OrgRole } from "@/lib/db/types";

// ── Multi-tenancy / RBAC (§6) ──────────────────────────────────────────
// Deliberately reuses AgentProvider as the tenant/"organization" record
// instead of introducing a parallel Organization model: it was already a
// 1-user-owned record with its own status (lib/agents/providerAuth.ts).
// OrganizationMember is what turns that into real multi-user RBAC.

const ROLE_RANK: Record<OrgRole, number> = { VIEWER: 1, OPERATOR: 2, ADMIN: 3, OWNER: 4 };

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface OrganizationContext {
  organizationId: string;
  role: OrgRole;
  user: SessionUser;
}

// Self-healing: an AgentProvider created before OrganizationMember existed
// (or the auto-provisioned personal org below) always has its owner's
// membership backfilled lazily here, rather than requiring a migration to
// run before RBAC works.
async function ensureOwnerMembership(organizationId: string, ownerUserId: string) {
  const existing = await db.organizationMember.findFirst({ where: { organizationId, userId: ownerUserId } });
  if (existing) return existing;
  return db.organizationMember.create({ data: { organizationId, userId: ownerUserId, role: "OWNER" } });
}

// Every signed-in user has exactly one "personal organization" for the MVP
// (mirrors AgentProvider.ownerUserId's existing uniqueness) - auto-created
// on first use so task creation never requires an explicit org-setup step,
// the same demo-friendly fallback pattern as ensureDemoUser().
export async function resolveOrCreatePersonalOrg(user: SessionUser): Promise<string> {
  let provider = await db.agentProvider.findFirst({ where: { ownerUserId: user.userId } });
  if (!provider) {
    provider = await db.agentProvider.create({
      data: {
        name: user.name ? `${user.name}'s Organization` : "Personal Organization",
        contactEmail: user.email,
        ownerUserId: user.userId,
        status: "ACTIVE",
      },
    });
  }
  await ensureOwnerMembership(provider.id, provider.ownerUserId);
  return provider.id;
}

export type OrgAuthResult = { context: OrganizationContext } | { error: string; status: number };
export type MembershipDecision = { allowed: true; role: OrgRole } | { allowed: false; reason: string; status: 404 | 403 };

// Pure authorization decision - no DB, no I/O - mirroring circuitBreaker.ts/
// credentials.ts's style, so cross-tenant isolation and role-gating are unit
// testable without a live database. `organizationExists` lets the 404 path
// (unknown org) be distinguished from the "not a member" path, while both
// return the SAME status/shape to the caller so a non-member can't tell
// which case they hit (no existence leak either way).
export function evaluateMembership(params: {
  organizationExists: boolean;
  membership: { role: OrgRole } | null;
  minRole: OrgRole;
}): MembershipDecision {
  if (!params.organizationExists || !params.membership) {
    return { allowed: false, reason: "Organization not found", status: 404 };
  }
  if (!roleAtLeast(params.membership.role, params.minRole)) {
    return { allowed: false, reason: `Requires ${params.minRole} role or higher (you are ${params.membership.role})`, status: 403 };
  }
  return { allowed: true, role: params.membership.role };
}

// Resolves the session user AND verifies they are a member of
// `organizationId` with at least `minRole`, via the pure decision above.
// 404s (not 403) when the caller isn't a member at all, so this never
// confirms or denies that some OTHER org's data exists for a non-member
// probing an id.
export async function requireOrgRole(request: Request, organizationId: string, minRole: OrgRole): Promise<OrgAuthResult> {
  const session = await resolveSessionUser(request);
  if ("error" in session) return session;

  const provider = await db.agentProvider.findUnique({ where: { id: organizationId } });

  let membership = provider ? await db.organizationMember.findFirst({ where: { organizationId, userId: session.user.userId } }) : null;
  if (provider && !membership && provider.ownerUserId === session.user.userId) {
    membership = await ensureOwnerMembership(organizationId, provider.ownerUserId);
  }

  const decision = evaluateMembership({ organizationExists: Boolean(provider), membership, minRole });
  if (!decision.allowed) return { error: decision.reason, status: decision.status };

  return { context: { organizationId, role: decision.role, user: session.user } };
}
