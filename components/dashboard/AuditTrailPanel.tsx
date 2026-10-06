"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { authHeader } from "@/lib/auth/clientAuth";
import { cn } from "@/lib/utils";

interface AuditEntry {
  timestamp: string;
  taskId: string | null;
  actor: string | null;
  category: "LIFECYCLE" | "SECURITY" | "PERMISSION";
  eventType: string;
  summary: string;
  payload: unknown;
}

const CATEGORY_TONE: Record<AuditEntry["category"], string> = {
  LIFECYCLE: "bg-muted text-muted-foreground",
  SECURITY: "bg-destructive/10 text-destructive",
  PERMISSION: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

// §5: the audit export UI - a filtered view over Event/SecurityEvent for
// this organization's tasks, closing the gap identified in the audit
// (per-task retrieval and live SSE already existed; a cross-task,
// organization-scoped query/export did not).
export function AuditTrailPanel({ organizationId }: { organizationId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<"ALL" | AuditEntry["category"]>("ALL");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit/export?organizationId=${organizationId}`, { headers: await authHeader() });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't load the audit trail.");
        return;
      }
      setEntries(data.entries);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [organizationId]);

  async function exportAs(format: "json" | "csv") {
    try {
      const res = await fetch(`/api/audit/export?organizationId=${organizationId}&format=${format}`, { headers: await authHeader() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kraven-audit-${organizationId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't reach the server.");
    }
  }

  const filtered = (entries ?? []).filter((e) => category === "ALL" || e.category === category);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(["ALL", "LIFECYCLE", "SECURITY", "PERMISSION"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => exportAs("csv")}>
            <Download className="size-3.5" /> CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportAs("json")}>
            <Download className="size-3.5" /> JSON
          </Button>
        </div>
      </div>

      {loading && entries === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading audit trail…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No audit events yet for this organization.</p>
      ) : (
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-1.5 pr-2 font-mono text-xs">
            {filtered.map((e, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border border-border/50 px-2.5 py-1.5">
                <span className="shrink-0 text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide", CATEGORY_TONE[e.category])}>
                  {e.category}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{e.summary}</span>
                {e.taskId && <span className="shrink-0 text-muted-foreground">{e.taskId.slice(0, 10)}</span>}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
