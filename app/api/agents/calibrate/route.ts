import { NextResponse } from "next/server";
import { z } from "zod";
import { calibrateAgents } from "@/lib/agents/calibration";
import { isSarvamConfigured } from "@/lib/manager/sarvam";

export const maxDuration = 300;

const bodySchema = z.object({ agentIds: z.array(z.string()).optional() });

// Measures agents on fixed benchmarks with the real worker + independent QA
// and stores the results (lib/agents/calibration.ts).
export async function POST(req: Request) {
  if (!isSarvamConfigured()) {
    return NextResponse.json({ error: "SARVAM_API_KEY is not set - cannot calibrate agents." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }
  const runs = await calibrateAgents({ agentIds: parsed.data.agentIds });
  return NextResponse.json({
    recorded: runs.filter((r) => r.status === "recorded").length,
    skipped: runs.filter((r) => r.status === "skipped").length,
    runs,
  });
}
