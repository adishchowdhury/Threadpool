import { NextResponse } from "next/server";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";
import { testExternalConnection } from "@/lib/agents/externalClient";

// §19: cheap health-check round trip, independent of calibration.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const result = await testExternalConnection(owned.agent!);
  return NextResponse.json(result);
}
