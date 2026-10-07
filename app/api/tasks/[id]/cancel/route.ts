import { NextResponse, after } from "next/server";
import { cancelTask } from "@/lib/manager/orchestrator";
import { drainBackground } from "@/lib/runtime/background";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await cancelTask(id);
  // Refunds mirror to Algorand in the background; keep the invocation alive
  // long enough for them to land.
  after(() => drainBackground(25_000));
  if (!result.cancelled) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
