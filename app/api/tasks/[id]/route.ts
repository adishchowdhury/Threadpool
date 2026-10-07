import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { failTask } from "@/lib/manager/orchestrator";

const TASK_INCLUDE = {
  subtasks: { orderBy: { sequence: "asc" as const }, include: { assignedAgent: true, bids: true } },
  centralEscrow: true,
};

// A task's actual work runs inside the POST /api/tasks invocation (after()),
// which Vercel kills once it hits the platform's time ceiling (the comment
// in app/api/tasks/route.ts explains why 300s was chosen). If a run legitimately
// takes longer than that - or the instance simply crashes/OOMs - the
// invocation dies mid-subtask with no chance to update the DB or emit a
// failure event, so the task sits in an active status forever with nothing
// left to move it: the dashboard polls this route every few seconds and would
// otherwise show "EXECUTING"/"waiting" indefinitely (CLAUDE.md §45 - never
// leave the system in a state the user can't make sense of). Since this route
// is already on that poll path, it doubles as the reconciliation point: if
// nothing has happened on the task for well past that ceiling, treat it as
// dead and fail it the same way a crashed orchestrator would (refunds every
// outstanding escrow, marks the task FAILED, emits TASK_FAILED).
const STALE_AFTER_MS = 6 * 60 * 1000;
const ACTIVE_TASK_STATUSES = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"]);

async function reconcileIfStale(taskId: string, task: any) {
  if (!ACTIVE_TASK_STATUSES.has(task.status)) return task;

  const lastEvent = await db.event.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" } });
  const lastActivityMs = lastEvent ? new Date(lastEvent.createdAt).getTime() : new Date(task.createdAt).getTime();
  if (Date.now() - lastActivityMs < STALE_AFTER_MS) return task;

  await failTask(
    taskId,
    "The workflow stopped making progress for several minutes - the execution was most likely terminated by the platform before it finished (it exceeded the serverless time limit). All escrowed funds have been refunded; please retry the task.",
  );
  return db.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let task = await db.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  task = await reconcileIfStale(id, task);
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
