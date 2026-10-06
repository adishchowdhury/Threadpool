import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const runs = await db.agentCalibration.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" } });
  const capabilities = JSON.parse(owned.agent!.capabilities) as string[];
  const coverage = capabilities.map((capability) => {
    const run = runs.find((r) => r.capability === capability);
    return { capability, qaScore: run?.qaScore ?? null, latencyMs: run?.latencyMs ?? null, calibrated: Boolean(run) };
  });

  return NextResponse.json({
    lifecycleStatus: owned.agent!.lifecycleStatus,
    status: owned.agent!.status,
    coverage,
    runs,
  });
}
