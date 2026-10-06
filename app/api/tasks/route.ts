import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { runTask } from "@/lib/manager/orchestrator";
import { ensureDemoUser, DEMO_USER_ID } from "@/lib/db/demoUser";
import { checkTaskSanity } from "@/lib/manager/sanityCheck";

// The orchestrator (run via after() below) now runs to completion inside
// this invocation instead of racing the platform freezing it post-response,
// so the invocation needs to actually be allowed to live that long. A full
// workflow (several subtasks, each with retries/reassignments and LLM/web
// calls) can take minutes; 800s is Vercel's ceiling for a Fluid Compute
// function. Bump the Vercel plan/config if a real workflow needs longer.
export const maxDuration = 800;

const createTaskSchema = z.object({
  prompt: z.string().min(3).max(2000),
  budget: z.number().int().positive().max(1000),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  deadline: z.string().datetime().optional(),
});

export async function GET() {
  // Chat history - scoped to the demo user until real accounts exist.
  const tasks = await db.task.findMany({
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

  // Semantic check, before any planning/discovery/escrow spend: syntactic
  // validation above only guarantees a string of plausible length, not that
  // it's an actionable request (e.g. "hello" or "asdfgh qwoeiur zzz").
  const sanity = await checkTaskSanity(prompt);
  if (!sanity.valid) {
    return NextResponse.json(
      { error: "Invalid task", message: "Please provide a clear, actionable task for Kraven to work on." },
      { status: 400 },
    );
  }

  // Guards against a freshly-migrated DB that hasn't run the seed script yet.
  await ensureDemoUser();

  const task = await db.task.create({
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

  await emitEvent(db, { taskId: task.id, actor: "system", eventType: "TASK_CREATED", payload: { prompt, budget } });

  // Runs after the response is sent, but - critically - under Next.js'
  // after() so the serverless runtime keeps this invocation alive until the
  // orchestrator finishes instead of freezing/recycling it the instant the
  // response flushes. A bare un-awaited promise here (the old code) raced the
  // platform: on Vercel the function can be suspended mid-await as soon as
  // POST returns, which is what left production tasks stuck "in progress"
  // for minutes with no further progress until the instance happened to be
  // reused. The Event/SSE stream (backed by the DB, not just the in-memory
  // bus) remains the source of truth for state - this only decides whether
  // the work backing those events keeps running.
  after(() =>
    runTask(task.id).catch(async (err) => {
      console.error("Orchestrator error for task", task.id, err);
      const reason = err instanceof Error ? `internal orchestrator error: ${err.message}` : "internal orchestrator error";
      await db.task
        .update({
          where: { id: task.id },
          data: { status: "FAILED", finalOutput: JSON.stringify({ content: null, failure_reason: reason }) },
        })
        .catch(() => {});
    }),
  );

  return NextResponse.json({ task }, { status: 201 });
}
