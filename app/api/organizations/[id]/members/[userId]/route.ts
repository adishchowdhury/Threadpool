import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { requireOrgRole } from "@/lib/auth/rbac";

// Removes a teammate's access. OWNER/ADMIN only, and the owner can never be
// removed this way (there is always exactly one owner, set at org creation).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id: organizationId, userId } = await params;
  const auth = await requireOrgRole(request, organizationId, "ADMIN");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const member = await db.organizationMember.findFirst({ where: { organizationId, userId } });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (member.role === "OWNER") return NextResponse.json({ error: "The organization owner cannot be removed." }, { status: 400 });

  await db.organizationMember.deleteMany({ where: { id: member.id } });
  return NextResponse.json({ ok: true });
}
