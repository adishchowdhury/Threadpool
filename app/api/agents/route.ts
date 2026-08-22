import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const agents = await prisma.agent.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({
    agents: agents.map((a) => ({ ...a, capabilities: JSON.parse(a.capabilities) })),
  });
}
