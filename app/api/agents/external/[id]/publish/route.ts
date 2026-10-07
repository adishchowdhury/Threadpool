import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";
import { evaluatePublish } from "@/lib/discovery/access";

const bodySchema = z.object({ visibility: z.enum(["PRIVATE", "MARKETPLACE"]) });

// Publish an owned agent to the shared marketplace, or pull it back to
// private. Publishing requires Kraven's own benchmark (calibration) to have
// activated the agent - the provider's claims alone never qualify.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "visibility must be PRIVATE or MARKETPLACE" }, { status: 400 });

  // The preference is always saved. The agent only actually goes public when
  // Kraven's benchmark allows it; otherwise it stays private and is published
  // automatically once calibration passes.
  const wantsPublic = parsed.data.visibility === "MARKETPLACE";
  const gate = wantsPublic ? evaluatePublish(owned.agent!) : { ok: true as const };
  const updated = await db.agent.update({
    where: { id },
    data: { visibilityPreference: parsed.data.visibility, visibility: wantsPublic && gate.ok ? "MARKETPLACE" : "PRIVATE" },
  });
  await emitEvent(db, { actor: auth.provider.id, eventType: "AGENT_PUBLISHED", payload: { agentId: id, visibility: updated.visibility, requested: parsed.data.visibility } });
  return NextResponse.json({
    agent: { id: updated.id, visibility: updated.visibility, visibilityPreference: updated.visibilityPreference },
    pending: wantsPublic && !gate.ok ? gate.reason : null,
  });
}
