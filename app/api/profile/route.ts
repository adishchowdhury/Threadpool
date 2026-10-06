import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { resolveSessionUser } from "@/lib/auth/session";
import { resolveOrCreatePersonalOrg } from "@/lib/auth/rbac";
import { CURRENT_PLAN_ID, getPlan } from "@/lib/billing/plans";

const DONE_STATUSES = new Set(["COMPLETED", "PARTIAL"]);
const ACTIVE_STATUSES = new Set(["CREATED", "PLANNING", "IN_PROGRESS", "AWAITING_QA", "CANCELLING"]);
const FAILED_STATUSES = new Set(["FAILED", "CANCELLED"]);

// Single read-model for the account/profile surface (Sidebar's account box).
// Aggregates identity + organization + task economics + (if present) the
// caller's own registered-agent overview, so the profile UI is one fetch
// instead of stitching together /api/providers/me and ad-hoc task math.
export async function GET(request: Request) {
  const session = await resolveSessionUser(request);
  if ("error" in session) return NextResponse.json({ error: session.error }, { status: session.status });

  const organizationId = await resolveOrCreatePersonalOrg(session.user);

  const [dbUser, provider, membership, memberCount, tasks, agents, securityBlocks] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.userId } }),
    db.agentProvider.findUnique({ where: { id: organizationId } }),
    db.organizationMember.findFirst({ where: { organizationId, userId: session.user.userId } }),
    db.organizationMember.count({ where: { organizationId } }),
    db.task.findMany({ where: { organizationId } }),
    db.agent.findMany({ where: { providerId: organizationId } }),
    db.securityEvent.count({ where: { organizationId, type: "CIRCUIT_BREAKER_BLOCK" } }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const subtasks = taskIds.length
    ? await db.subtask.findMany({ where: { taskId: { in: taskIds }, qaScore: { not: null } } })
    : [];

  const totalBudgeted = tasks.reduce((s, t) => s + t.budget, 0);
  const totalSpent = tasks.reduce((s, t) => s + (t.budget - t.remainingBudget), 0);
  const avgQuality = subtasks.length
    ? Math.round(subtasks.reduce((s, st) => s + st.qaScore, 0) / subtasks.length)
    : null;

  const agentIds = agents.map((a) => a.id);
  const jobs = agentIds.length ? await db.agentPerformance.findMany({ where: { agentId: { in: agentIds } } }) : [];

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const tasksThisMonth = tasks.filter((t) => new Date(t.createdAt).getTime() >= startOfMonth.getTime()).length;
  const plan = getPlan(CURRENT_PLAN_ID);

  return NextResponse.json({
    user: {
      id: session.user.userId,
      email: session.user.email ?? dbUser?.email ?? null,
      name: session.user.name ?? dbUser?.name ?? null,
      isDemo: dbUser?.isDemo ?? false,
      joinedAt: dbUser?.createdAt ?? null,
      authProvider: session.user.userId === "demo-user" ? "Local demo" : "Firebase",
    },
    organization: provider && {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      status: provider.status,
      role: membership?.role ?? "OWNER",
      memberCount,
      createdAt: provider.createdAt,
    },
    taskStats: {
      total: tasks.length,
      completed: tasks.filter((t) => DONE_STATUSES.has(t.status)).length,
      active: tasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
      failed: tasks.filter((t) => FAILED_STATUSES.has(t.status)).length,
      totalBudgeted,
      totalSpent,
      avgQuality,
    },
    workforce: agents.length
      ? {
          agents: agents.length,
          activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
          jobsCompleted: jobs.length,
          successRate: jobs.length ? jobs.filter((j) => j.success).length / jobs.length : null,
          avgQaScore: jobs.length ? jobs.reduce((s, j) => s + j.qaScore, 0) / jobs.length : null,
          totalEarned: agents.reduce((s, a) => s + a.totalJobs * a.avgCost, 0),
        }
      : null,
    security: {
      blockedAttempts: securityBlocks,
    },
    plan: {
      id: plan.id,
      name: plan.name,
      billingNote: "Free during early access - no card on file, nothing is charged.",
      maxBudgetPerTask: plan.maxBudgetPerTask,
      tasksPerMonth: plan.tasksPerMonth,
      tasksUsedThisMonth: tasksThisMonth,
    },
  });
}
