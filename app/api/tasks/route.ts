import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { runTaskSegment } from "@/lib/manager/taskRunner";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";
import { checkTaskSanity } from "@/lib/manager/sanityCheck";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";

// Hosts the task's first execution segment (after() below). Segment budgets
// in lib/manager/taskRunner.ts assume this limit.
export const maxDuration = 300;

const createTaskSchema = z.object({
  prompt: z.string().min(3).max(6000),
  budget: z.number().int().positive().max(1000),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  deadline: z.string().datetime().optional(),
});

export async function GET(request: Request) {
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });
  const organizationId = await resolveOrCreatePersonalOrg(session.user);

  // Chat history - scoped to the caller's organization (§6), not merely
  // their user id, so teammates sharing an org see the same task list.
  const tasks = await db.task.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });
  const organizationId = await resolveOrCreatePersonalOrg(session.user);

  const body = await request.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = parsed.error.flatten();
    const message =
      Object.entries(fieldErrors)
        .map(([field, errors]) => (errors?.length ? `${field}: ${errors.join(", ")}` : null))
        .filter(Boolean)
        .join("; ") ||
      formErrors.join("; ") ||
      "Invalid request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { prompt, budget, qualityThreshold, deadline } = parsed.data;

  // Semantic check, before any planning/discovery/escrow spend: syntactic
  // validation above only guarantees a string of plausible length, not that
  // it's an actionable request (e.g. "hello" or "asdfgh qwoeiur zzz").
  const sanity = await checkTaskSanity(prompt);
  if (!sanity.valid) {
    return NextResponse.json(
      { error: "Please provide a clear, actionable task for Kraven to work on." },
      { status: 400 },
    );
  }

  // Guards against a freshly-migrated DB that hasn't run the seed script yet.
  await ensureDemoUser();
  await db.user.upsert({
    where: { id: session.user.userId },
    update: {},
    create: { id: session.user.userId, email: session.user.email ?? `${session.user.userId}@kraven.local`, name: session.user.name ?? session.user.userId, isDemo: session.user.userId === DEMO_USER_ID },
  });

  const task = await db.task.create({
    data: {
      prompt,
      budget,
      remainingBudget: budget,
      qualityThreshold: qualityThreshold ?? 70,
      deadline: deadline ? new Date(deadline) : null,
      status: "CREATED",
      userId: session.user.userId,
      organizationId,
    },
  });

  await emitEvent(db, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt, budget } });

  // First execution segment, under after() so the invocation stays alive
  // after the response is sent. Later segments run in their own invocations
  // (lib/manager/taskRunner.ts). The segment's deadline is measured from the
  // start of this request, since maxDuration counts from there.
  after(() => runTaskSegment(task.id, requestStartedAt));

  return NextResponse.json({ task }, { status: 201 });
}
