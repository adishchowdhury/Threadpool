import { NextResponse } from "next/server";

// Reference implementation of the health-check half of Kraven's external
// agent contract (lib/agents/externalClient.ts). This is a genuinely
// separate HTTP endpoint, called through the exact same fetch/timeout/SSRF
// path as any real third-party agent - it exists so the full round trip can
// be demoed without a second deployment. A real provider implements this
// contract on their own infrastructure instead.
export async function POST() {
  return NextResponse.json({ status: "ok" });
}
