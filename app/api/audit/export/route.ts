import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/auth/rbac";
import { exportAuditTrail, toCsv } from "@/lib/audit/exportTrail";

// §5: HTTP surface over lib/audit/exportTrail.ts's shared query. RBAC is
// enforced HERE (membership check) before the trail is ever built - the
// shared function trusts organizationId precisely because this route has
// already verified the caller belongs to it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "organizationId is required" }, { status: 400 });

  const auth = await requireOrgRole(request, organizationId, "VIEWER");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const result = await exportAuditTrail({
    organizationId,
    taskId: url.searchParams.get("taskId"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (format === "csv") {
    return new NextResponse(toCsv(result.entries), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="kraven-audit-${organizationId}.csv"` },
    });
  }
  return NextResponse.json({ entries: result.entries });
}
