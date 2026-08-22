import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Persisted event history for one task — used to replay a past chat's
// activity feed on reopen, since the live SSE stream only buffers events
// seen during the current browser session.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await prisma.event.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
  });
  const events = rows.map((row) => {
    let payload: unknown = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // leave as empty object if somehow malformed
    }
    return {
      id: row.id,
      taskId: row.taskId,
      actor: row.actor,
      eventType: row.eventType,
      payload,
      createdAt: row.createdAt.toISOString(),
    };
  });
  return NextResponse.json({ events });
}
