import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";
import { updateExternalAgentSchema } from "@/lib/agents/externalSchemas";
import { validateExternalEndpoint } from "@/lib/agents/externalSecurity";
import { encryptSecret, withoutExternalSecret } from "@/lib/agents/secrets";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  return NextResponse.json({ agent: { ...withoutExternalSecret(owned.agent!), capabilities: JSON.parse(owned.agent!.capabilities) } });
}

// §17/§36: mutate price/endpoint/auth token, or apply a self-service safety
// control (pause/suspend/reactivate). A suspended/paused agent's `status`
// flips immediately so lib/discovery stops returning it to the router.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const parsed = updateExternalAgentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const update: Record<string, unknown> = {};
  if (data.description !== undefined) update.role = data.description;
  if (data.price !== undefined) update.price = data.price;
  if (data.endpoint !== undefined) {
    const check = validateExternalEndpoint(data.endpoint);
    if (!check.valid) return NextResponse.json({ error: `Invalid endpoint: ${check.reason}` }, { status: 400 });
    update.endpoint = data.endpoint;
  }
  if (data.authToken !== undefined) update.externalAuthSecretEncrypted = encryptSecret(data.authToken);

  const agent = owned.agent!;
  if (data.action === "pause") {
    update.lifecycleStatus = "PAUSED";
    update.status = "INACTIVE";
  } else if (data.action === "suspend") {
    update.lifecycleStatus = "SUSPENDED";
    update.status = "REVOKED";
  } else if (data.action === "reactivate") {
    if (agent.lifecycleStatus !== "PAUSED" && agent.lifecycleStatus !== "SUSPENDED") {
      return NextResponse.json({ error: `Cannot reactivate from ${agent.lifecycleStatus}` }, { status: 409 });
    }
    update.lifecycleStatus = "ACTIVE";
    update.status = "ACTIVE";
  }

  const updated = await db.agent.update({ where: { id }, data: update });
  return NextResponse.json({ agent: { ...withoutExternalSecret(updated), capabilities: JSON.parse(updated.capabilities) } });
}

// Soft delete only - preserves ledger/performance referential integrity.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  await db.agent.update({ where: { id }, data: { status: "REVOKED", lifecycleStatus: "SUSPENDED", listed: false } });
  return NextResponse.json({ ok: true });
}
