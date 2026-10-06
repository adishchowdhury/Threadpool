import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { requireOrgRole } from "@/lib/auth/rbac";

const inviteMemberSchema = z.object({
  // No account/invite system yet - a teammate is added by the user id they
  // sign in with (their Firebase uid, or the demo user id in local mode).
  // Swap this for an email-invite flow once real accounts/invites exist.
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]), // never OWNER via invite - exactly one owner, set at org creation
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: organizationId } = await params;
  const auth = await requireOrgRole(request, organizationId, "VIEWER");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const members = await db.organizationMember.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ members });
}

// §6: only OWNER/ADMIN can grant access to the organization's tasks,
// agents, credentials, budgets, ledger and audit trail.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: organizationId } = await params;
  const auth = await requireOrgRole(request, organizationId, "ADMIN");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = inviteMemberSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.organizationMember.findFirst({ where: { organizationId, userId: parsed.data.userId } });
  if (existing) {
    return NextResponse.json({ error: "This user is already a member of the organization." }, { status: 409 });
  }

  const member = await db.organizationMember.create({
    data: { organizationId, userId: parsed.data.userId, role: parsed.data.role },
  });
  return NextResponse.json({ member }, { status: 201 });
}
