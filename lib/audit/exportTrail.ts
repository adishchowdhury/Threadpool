// §5: the enterprise audit trail. Event/SecurityEvent were already written
// at nearly every lifecycle point (task creation, ranking/selection
// reasons, permissions, escrow, QA, payouts/refunds, reassignment, final
// outcome); what was missing was a cross-task, organization-scoped
// query/export. This is a filtered MERGE of what's already persisted, not
// a new log store. Shared by app/api/audit/export/route.ts and
// scripts/demo-full-loop.ts so the two never drift into separate logic.
import { db } from "@/lib/db/client";

export type AuditCategory = "LIFECYCLE" | "SECURITY" | "PERMISSION";

export interface AuditEntry {
  timestamp: string;
  taskId: string | null;
  actor: string | null;
  category: AuditCategory;
  eventType: string;
  summary: string;
  payload: unknown;
}

function categoryForEvent(eventType: string): AuditCategory {
  if (eventType.startsWith("PERMISSION_")) return "PERMISSION";
  if (eventType === "TRANSACTION_BLOCKED" || eventType === "WALLET_REVOKED" || eventType === "AGENT_AUTO_DEMOTED") return "SECURITY";
  return "LIFECYCLE";
}

function categoryForSecurityEvent(type: string): AuditCategory {
  return type.startsWith("PERMISSION_") ? "PERMISSION" : "SECURITY";
}

export function toCsv(entries: AuditEntry[]): string {
  const header = ["timestamp", "taskId", "actor", "category", "eventType", "summary", "payload"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = entries.map((e) =>
    [e.timestamp, e.taskId, e.actor, e.category, e.eventType, e.summary, JSON.stringify(e.payload)].map(escape).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export type ExportTrailResult = { ok: true; entries: AuditEntry[] } | { ok: false; error: string; status: 404 };

// Scoping: Event/SecurityEvent carry taskId, not organizationId directly, so
// the caller's own task set is resolved first, then events are filtered to
// that set - never a client-supplied organizationId taken on faith for the
// event query itself. Callers (the API route) must have already verified
// org membership (lib/auth/rbac.ts's requireOrgRole) before calling this.
export async function exportAuditTrail(params: {
  organizationId: string;
  taskId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ExportTrailResult> {
  const orgTasks = await db.task.findMany({ where: { organizationId: params.organizationId } });
  const orgTaskIds = new Set(orgTasks.map((t: any) => t.id));

  let taskIds: string[];
  if (params.taskId) {
    if (!orgTaskIds.has(params.taskId)) {
      return { ok: false, error: "Task not found in this organization", status: 404 };
    }
    taskIds = [params.taskId];
  } else {
    taskIds = [...orgTaskIds];
  }

  if (taskIds.length === 0) return { ok: true, entries: [] };

  const createdAtFilter: Record<string, Date> = {};
  if (params.from) createdAtFilter.gte = new Date(params.from);
  if (params.to) createdAtFilter.lte = new Date(params.to);
  const timeWhere = Object.keys(createdAtFilter).length ? { createdAt: createdAtFilter } : {};

  const [events, securityEvents] = await Promise.all([
    db.event.findMany({ where: { taskId: { in: taskIds }, ...timeWhere }, orderBy: { createdAt: "asc" } }),
    db.securityEvent.findMany({ where: { taskId: { in: taskIds }, ...timeWhere }, orderBy: { createdAt: "asc" } }),
  ]);

  const entries: AuditEntry[] = [
    ...events.map((row: any) => {
      let payload: unknown = {};
      try {
        payload = JSON.parse(row.payload);
      } catch {}
      const human = row.eventType.replace(/_/g, " ").toLowerCase();
      return {
        timestamp: row.createdAt.toISOString(),
        taskId: row.taskId,
        actor: row.actor,
        category: categoryForEvent(row.eventType),
        eventType: row.eventType,
        summary: `${row.actor} - ${human}`,
        payload,
      };
    }),
    ...securityEvents.map((row: any) => {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.payload);
        if (parsed && typeof parsed === "object") payload = parsed;
      } catch {}
      return {
        timestamp: row.createdAt.toISOString(),
        taskId: row.taskId,
        actor: row.agentId ?? "circuit_breaker",
        category: categoryForSecurityEvent(row.type),
        eventType: row.type,
        summary: `${row.agentId ?? "circuit_breaker"} - ${row.reason}`,
        payload: { ...payload, severity: row.severity, requestedAmount: row.requestedAmount, allowedAmount: row.allowedAmount },
      } satisfies AuditEntry;
    }),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { ok: true, entries };
}
