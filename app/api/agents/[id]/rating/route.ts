import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";

const bodySchema = z.object({ taskId: z.string().min(1), rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });

// A rating is accepted only from the org that ran the task, only for an agent
// that actually worked on it, and only once. It never touches benchmark data.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });
  const organizationId = await resolveOrCreatePersonalOrg(session.user);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { taskId, rating, comment } = parsed.data;

  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.organizationId !== organizationId) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const worked = await db.agentPerformance.count({ where: { taskId, agentId: id } });
  if (worked === 0) return NextResponse.json({ error: "This agent did not work on that task." }, { status: 409 });
  if (await db.agentRating.findFirst({ where: { agentId: id, taskId } })) return NextResponse.json({ error: "Already rated." }, { status: 409 });

  const row = await db.agentRating.create({ data: { agentId: id, taskId, organizationId, rating, comment: comment ?? null } });
  return NextResponse.json({ rating: { id: row.id, rating: row.rating } }, { status: 201 });
}
