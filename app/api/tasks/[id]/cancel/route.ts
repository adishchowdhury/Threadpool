import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/manager/orchestrator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await cancelTask(id);
  if (!result.cancelled) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
