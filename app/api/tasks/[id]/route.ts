import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { needsSegment, runTaskSegment } from "@/lib/manager/taskRunner";

// Can host a resumed execution segment (see GET below).
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const { id } = await params;
  const task = await db.task.findUnique({
    where: { id },
    include: {
      subtasks: { orderBy: { sequence: "asc" }, include: { assignedAgent: true, bids: true } },
      centralEscrow: true,
    },
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Self-healing: the dashboard polls this route while a task runs. If the
  // task is still active but no segment holds its lease - the previous one
  // was killed, or its hand-off request never arrived - resume it from here.
  // The lease guarantees only one segment runs even if several polls race.
  if (needsSegment(task)) after(() => runTaskSegment(id, startedAt));

  return NextResponse.json({ task });
}

const patchTaskSchema = z.object({
  pinned: z.boolean(),
});

// Sidebar-only metadata (currently just pin state). Never exposes a path to
// mutate status, budget, or anything the economic engine owns.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const existing = await db.task.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const task = await db.task.update({ where: { id }, data: { pinned: parsed.data.pinned } });
  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.task.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Removes the task from history only. Ledger, escrow, and event records
  // stay put - they're the financial audit trail, not conversation history.
  await db.subtask.deleteMany({ where: { taskId: id } });
  await db.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
