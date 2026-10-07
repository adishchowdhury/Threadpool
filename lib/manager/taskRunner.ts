import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { models } from "@/lib/db/models";
import { connectMongoose } from "@/lib/db/mongoose";
import { emitEvent } from "@/lib/events/emit";
import { failTask, runTask, type SegmentOutcome } from "@/lib/manager/orchestrator";
import { runWithDeadline } from "@/lib/runtime/deadline";
import { drainBackground } from "@/lib/runtime/background";

// Durable task execution.
//
// A full workflow (planning, several research/analysis/writing steps with
// live web search and LLM calls, QA, retries, the final review and its
// rework) routinely needs longer than one serverless invocation is allowed to
// live (maxDuration = 300s on the routes that host it). Running it all in one
// invocation meant the platform killed it mid-step, leaving the task frozen
// with escrow locked.
//
// Instead a task runs as a chain of segments. Each segment:
//   1. takes the task's lease (only one segment ever runs at a time),
//   2. runs the orchestrator under a hard deadline safely inside the
//      invocation limit (lib/runtime/deadline.ts) - the orchestrator only
//      starts work it can finish and otherwise "yields",
//   3. releases the lease and, if it yielded, starts the next segment in a
//      fresh invocation (POST /api/tasks/:id/continue),
//   4. gives background side effects (Algorand mirroring) the rest of the
//      invocation to finish.
// If a segment dies anyway (crash, platform kill), its lease simply expires;
// the dashboard's next poll of GET /api/tasks/:id resumes the task, and the
// orchestrator settles whatever the dead segment left half-done.

export const SEGMENT_BUDGET_MS = 265_000;
const INVOCATION_LIMIT_MS = 295_000;
const LEASE_MS = 300_000;
// Each segment fits roughly one or two rounds of attempts; a large plan with
// retries needs several. The last one soft-skips whatever is left so the task
// still finishes with a report.
export const MAX_SEGMENTS = 10;
const RUNNABLE_STATUSES = ["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA"];

async function acquireLease(taskId: string): Promise<{ segment: number } | null> {
  await connectMongoose();
  const now = new Date();
  const doc = await models.Task.findOneAndUpdate(
    // `leaseUntil: null` also matches tasks created before the field existed.
    { _id: taskId, status: { $in: RUNNABLE_STATUSES }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { segment: 1 } },
    { returnDocument: "after" },
  ).lean<{ segment: number }>();
  return doc ? { segment: doc.segment } : null;
}

async function releaseLease(taskId: string) {
  await connectMongoose();
  await models.Task.updateOne({ _id: taskId }, { $set: { leaseUntil: null } });
}

// Whether a task needs a segment started for it right now: still running,
// and no live segment holds its lease.
export function needsSegment(task: { status: string; leaseUntil?: Date | string | null }): boolean {
  if (!RUNNABLE_STATUSES.includes(task.status)) return false;
  return !task.leaseUntil || new Date(task.leaseUntil).getTime() < Date.now();
}

export async function runTaskSegment(taskId: string, invocationStartedAt: number): Promise<void> {
  const lease = await acquireLease(taskId);
  if (!lease) return;

  let outcome: SegmentOutcome = { status: "stopped" };
  try {
    if (lease.segment > MAX_SEGMENTS) {
      await failTask(taskId, `The workflow did not finish within ${MAX_SEGMENTS} execution segments. All escrowed funds have been refunded; please retry the task.`);
    } else {
      if (lease.segment > 1) {
        await emitEvent(db, { taskId, actor: "system", eventType: "WORKFLOW_CONTINUED", payload: { segment: lease.segment } });
      }
      outcome = await runWithDeadline(invocationStartedAt + SEGMENT_BUDGET_MS, () =>
        runTask(taskId, { finalSegment: lease.segment >= MAX_SEGMENTS }),
      );
    }
  } catch (err) {
    console.error("Orchestrator error for task", taskId, err);
    await failTask(taskId, `internal orchestrator error: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
  } finally {
    await releaseLease(taskId).catch((err) => console.error("Failed to release task lease", taskId, err));
  }

  if (outcome.status === "yielded") await requestContinuation(taskId);
  await drainBackground(invocationStartedAt + INVOCATION_LIMIT_MS - Date.now());
}

function appBaseUrl(): string | null {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (!process.env.VERCEL) return `http://localhost:${process.env.PORT ?? 3000}`;
  return null;
}

function continuationSecret(): string {
  return process.env.INTERNAL_API_SECRET ?? process.env.CRON_SECRET ?? process.env.MONGODB_URI ?? "kraven-local";
}

export function continuationToken(taskId: string): string {
  return createHmac("sha256", continuationSecret()).update(`continue:${taskId}`).digest("hex");
}

export function isValidContinuationToken(taskId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(continuationToken(taskId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Best effort: if this request doesn't land, the dashboard's polling of
// GET /api/tasks/:id resumes the task as soon as it sees the free lease.
async function requestContinuation(taskId: string): Promise<void> {
  const base = appBaseUrl();
  if (!base) return;
  try {
    const res = await fetch(`${base}/api/tasks/${taskId}/continue`, {
      method: "POST",
      headers: { "x-kraven-continuation": continuationToken(taskId) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[taskRunner] continuation request for ${taskId} returned HTTP ${res.status}`);
  } catch (err) {
    console.error(`[taskRunner] continuation request for ${taskId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
