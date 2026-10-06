import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { testExternalConnection } from "@/lib/agents/externalClient";
import { emitEvent } from "@/lib/events/emit";

// §7 polish: automatic health checks for external agents. Reuses the exact
// same check as the manual "Test Connection" button (lib/agents/
// externalClient.ts's testExternalConnection) - this just runs it on a
// schedule (vercel.json cron, which invokes via GET) instead of a click,
// and demotes an ACTIVE agent that fails it. Idempotent and safe to call
// repeatedly or concurrently: each agent's update is independent.
async function runSweep() {
  const candidates = await db.agent.findMany({
    where: { isExternal: true, status: { not: "REVOKED" }, lifecycleStatus: { not: "FAILED_CALIBRATION" } },
  });

  const results = await Promise.all(
    candidates.map(async (agent: any) => {
      const check = await testExternalConnection({ id: agent.id, endpoint: agent.endpoint, externalAuthSecretEncrypted: agent.externalAuthSecretEncrypted });
      const demote = !check.ok && agent.status === "ACTIVE";

      await db.agent.update({
        where: { id: agent.id },
        data: {
          lastHealthCheckAt: new Date(),
          lastHealthStatus: check.ok ? "HEALTHY" : "UNHEALTHY",
          ...(demote ? { status: "INACTIVE" } : {}),
        },
      });

      if (demote) {
        await db.securityEvent.create({
          data: {
            agentId: agent.id,
            type: "AGENT_AUTO_DEMOTED",
            reason: `health check failed: ${check.message}`,
            payload: JSON.stringify({ previousStatus: "ACTIVE", newStatus: "INACTIVE", check }),
            severity: "MEDIUM",
          },
        });
        await emitEvent(db, {
          actor: "system",
          eventType: "AGENT_AUTO_DEMOTED",
          payload: { agentId: agent.id, reason: "automatic health check failed" },
        });
      }

      return { agentId: agent.id, name: agent.name, ok: check.ok, demoted: demote };
    }),
  );

  return { checked: results.length, demoted: results.filter((r) => r.demoted).length, results };
}

// Vercel Cron invokes scheduled routes with GET.
export async function GET() {
  return NextResponse.json(await runSweep());
}

// Manual trigger (e.g. a button in OrgWorkspace.tsx).
export async function POST() {
  return NextResponse.json(await runSweep());
}
