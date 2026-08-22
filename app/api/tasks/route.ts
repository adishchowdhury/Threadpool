import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { emitEvent } from "@/lib/events/emit";
import { runTask } from "@/lib/manager/orchestrator";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";

const createTaskSchema = z.object({
  prompt: z.string().min(3).max(2000),
  budget: z.number().int().positive().max(1000),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  deadline: z.string().datetime().optional(),
});

export async function GET() {
  // Chat history — scoped to the demo user until real accounts exist.
  const tasks = await prisma.task.findMany({
    where: { userId: DEMO_USER_ID },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { prompt, budget, qualityThreshold, deadline } = parsed.data;

  // Guards against a freshly-migrated DB that hasn't run the seed script yet.
  await ensureDemoUser();

  const task = await prisma.task.create({
    data: {
      prompt,
      budget,
      remainingBudget: budget,
      qualityThreshold: qualityThreshold ?? 70,
      deadline: deadline ? new Date(deadline) : null,
      status: "CREATED",
      userId: DEMO_USER_ID,
    },
  });

  await emitEvent(prisma, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt, budget } });

  // Fire-and-forget: the orchestrator drives state via the Event/SSE stream.
  // Errors are caught so an unexpected exception doesn't crash the process.
  runTask(task.id).catch(async (err) => {
    console.error("Orchestrator error for task", task.id, err);
    await prisma.task
      .update({
        where: { id: task.id },
        data: { status: "FAILED", finalOutput: JSON.stringify({ content: null, failure_reason: "internal orchestrator error" }) },
      })
      .catch(() => {});
  });

  return NextResponse.json({ task }, { status: 201 });
}
