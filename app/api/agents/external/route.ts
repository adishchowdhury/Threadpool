import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { requireProviderForUser } from "@/lib/agents/providerAuth";
import { registerExternalAgentSchema } from "@/lib/agents/externalSchemas";
import { validateExternalEndpoint } from "@/lib/agents/externalSecurity";
import { encryptSecret, withoutExternalSecret } from "@/lib/agents/secrets";
import { ensureAgentWallet } from "@/lib/economy/wallets";

// §9/§30: register an external agent under the authenticated provider.
// Starts PENDING/INACTIVE - it cannot receive routed work until it passes
// calibration (POST .../calibrate).
export async function POST(request: Request) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = registerExternalAgentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const endpointCheck = validateExternalEndpoint(data.endpoint);
  if (!endpointCheck.valid) {
    return NextResponse.json({ error: `Invalid endpoint: ${endpointCheck.reason}` }, { status: 400 });
  }

  const duplicate = await db.agent.findFirst({ where: { providerId: auth.provider.id, name: data.name, endpoint: data.endpoint } });
  if (duplicate) {
    return NextResponse.json({ error: "You already have an agent with this name and endpoint." }, { status: 409 });
  }

  const agent = await db.agent.create({
    data: {
      name: data.name,
      role: data.description ?? null,
      capabilities: JSON.stringify(data.capabilities),
      price: data.price,
      endpoint: data.endpoint,
      status: "INACTIVE", // not routable until calibration passes
      provider: "external",
      model: data.modelTier,
      isExternal: true,
      providerId: auth.provider.id,
      externalAuthSecretEncrypted: data.authToken ? encryptSecret(data.authToken) : null,
      lifecycleStatus: "PENDING",
      listed: true,
    },
  });
  await ensureAgentWallet(agent.id);

  return NextResponse.json({ agent: { ...withoutExternalSecret(agent), capabilities: data.capabilities } }, { status: 201 });
}

export async function GET(request: Request) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const agents = await db.agent.findMany({ where: { providerId: auth.provider.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    agents: agents.map((a) => ({ ...withoutExternalSecret(a), capabilities: JSON.parse(a.capabilities) })),
  });
}
