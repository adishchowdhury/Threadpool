import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET() {
  const agents = await db.agent.findMany({ where: { listed: { not: false } }, orderBy: { name: "asc" } });
  return NextResponse.json({
    agents: agents.map((a) => ({ ...a, capabilities: JSON.parse(a.capabilities) })),
  });
}
