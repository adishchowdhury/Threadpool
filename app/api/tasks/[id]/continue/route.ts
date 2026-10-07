import { NextResponse, after } from "next/server";
import { isValidContinuationToken, runTaskSegment } from "@/lib/manager/taskRunner";

// Hosts a task's next execution segment (lib/manager/taskRunner.ts).
export const maxDuration = 300;

// Internal: called by the previous segment when it hands off. The token is
// an HMAC of the task id with a server-only secret, so outside callers can't
// trigger segments; even if they could, the task lease keeps it to one at a
// time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  if (!isValidContinuationToken(id, request.headers.get("x-kraven-continuation"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  after(() => runTaskSegment(id, startedAt));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
