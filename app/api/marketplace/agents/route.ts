import { NextResponse } from "next/server";
import { listAgentsVisibleTo } from "@/lib/agents/visibleAgents";

// §21/§30: discovery listing - Kraven-certified and published agents plus
// the caller's own org's private agents (never another org's), extended with
// provider name and lifecycle status so the UI can show "External · {provider}".
export async function GET(request: Request) {
  return NextResponse.json({ agents: await listAgentsVisibleTo(request) });
}
