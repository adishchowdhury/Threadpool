import { NextResponse } from "next/server";
import { listAgentsVisibleTo } from "@/lib/agents/visibleAgents";

export async function GET(request: Request) {
  return NextResponse.json({ agents: await listAgentsVisibleTo(request) });
}
