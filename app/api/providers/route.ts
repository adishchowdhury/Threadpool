import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { registerProviderSchema } from "@/lib/agents/externalSchemas";

// Creates the signed-in user's organization (one per user for this MVP -
// lib/db/models.ts's AgentProvider.ownerUserId is unique). Idempotent: if
// the user already has one, their existing org is returned rather than
// erroring, so the "create your organization" form can't be double-clicked
// into a conflict.
export async function POST(request: Request) {
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const existing = await db.agentProvider.findFirst({ where: { ownerUserId: session.user.userId } });
  if (existing) {
    const member = await db.organizationMember.findFirst({ where: { organizationId: existing.id, userId: session.user.userId } });
    if (!member) await db.organizationMember.create({ data: { organizationId: existing.id, userId: session.user.userId, role: "OWNER" } });
    return NextResponse.json({ provider: existing });
  }

  const parsed = registerProviderSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const provider = await db.agentProvider.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      contactEmail: parsed.data.contactEmail ?? session.user.email ?? null,
      ownerUserId: session.user.userId,
      status: "ACTIVE",
    },
  });
  await db.organizationMember.create({ data: { organizationId: provider.id, userId: session.user.userId, role: "OWNER" } });

  return NextResponse.json({ provider }, { status: 201 });
}
