import { NextResponse, after } from "next/server";
import { db } from "@/lib/db/client";
import { requireProviderForUser, requireOwnedAgent } from "@/lib/agents/providerAuth";
import { calibrateExternalAgent } from "@/lib/agents/calibration";

export const maxDuration = 300;

// §10/§20: fire calibration and return immediately (same after()
// fire-and-poll pattern as POST /api/tasks) - the provider UI polls
// GET .../calibration for progress/results.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProviderForUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const owned = await requireOwnedAgent(auth.provider.id, id);
  if ("error" in owned) return NextResponse.json({ error: owned.error }, { status: owned.status });

  if (owned.agent!.lifecycleStatus === "CALIBRATING") {
    return NextResponse.json({ error: "Calibration already in progress" }, { status: 409 });
  }

  await db.agent.update({ where: { id }, data: { lifecycleStatus: "CALIBRATING" } });

  after(() =>
    calibrateExternalAgent(id).catch(async (err) => {
      console.error("External calibration error for agent", id, err);
      await db.agent.update({ where: { id }, data: { lifecycleStatus: "FAILED_CALIBRATION", status: "INACTIVE" } }).catch(() => {});
    }),
  );

  return NextResponse.json({ status: "CALIBRATING" }, { status: 202 });
}
