"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/dashboard/MarkdownView";
import type { TaskRecord } from "@/lib/types";
import type { NumericCheckReport } from "@/lib/manager/numericCheck";
import type { WorkerOutput } from "@/lib/manager/finalReport";
import { tokensWorthLabel } from "@/lib/economy/tokenValue";
import { AlertCircle, AlertTriangle, Ban, Check, CheckCircle2, ChevronDown, Coins, Copy, Download, Gauge, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function parseFinalOutput(task: TaskRecord): Record<string, unknown> | null {
  if (!task.finalOutput) return null;
  try {
    return JSON.parse(task.finalOutput) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "kraven-report"
  );
}

// The assistant's final message for a task: the deliverable itself, what it
// cost, and - one click away - how it was produced and verified.
export function TaskResult({ task }: { task: TaskRecord }) {
  const [copied, setCopied] = useState(false);
  const parsed = parseFinalOutput(task);

  if (task.status === "CANCELLED") {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Ban className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium text-foreground">Task stopped</div>
          <div>No report was produced. Any funds held for unfinished work were returned to the task budget.</div>
        </div>
      </div>
    );
  }

  if (task.status === "FAILED") {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <div className="font-medium text-destructive">The task couldn&apos;t be completed</div>
          <div className="mt-0.5 text-muted-foreground wrap-break-word">{String(parsed?.failure_reason ?? "An unexpected error stopped the workforce.")}</div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            Only work that passed quality review was paid for. Try again with a larger budget or a lower quality bar.
          </div>
        </div>
      </div>
    );
  }

  if ((task.status !== "COMPLETED" && task.status !== "PARTIAL") || !parsed) return null;

  const content = String(parsed.content ?? "");
  const spend = parsed.spend_summary as { budget: number; spent: number; remaining: number } | undefined;
  const outputs = Array.isArray(parsed.worker_outputs) ? (parsed.worker_outputs as WorkerOutput[]) : [];
  const agents = [...new Set(outputs.map((o) => o.agentName).filter(Boolean))] as string[];
  const quality = typeof parsed.avg_quality === "number" ? parsed.avg_quality : null;
  const review = (parsed.review ?? null) as ReviewSummary | null;
  const confidence = (parsed.confidence ?? null) as { score: number; label: "high" | "medium" | "low"; reason: string } | null;
  const incomplete = Array.isArray(parsed.incomplete_subtasks)
    ? (parsed.incomplete_subtasks as Array<{ type: string; requiredCapability: string; reason: string }>)
    : [];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Report copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy - clipboard access was denied.");
    }
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(task.prompt)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-3 duration-500 ease-out">
      {task.status === "PARTIAL" && incomplete.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <div className="font-medium text-amber-700 dark:text-amber-300">Completed with gaps</div>
            <div className="mt-0.5 text-muted-foreground">
              {incomplete.length} step{incomplete.length > 1 ? "s" : ""} couldn&apos;t be completed and no replacement agent was available. The rest of the
              workforce finished and the report below reflects that.
            </div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {incomplete.map((d, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{d.type.replace(/_/g, " ")}</span> — {d.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <article className="rounded-2xl border border-border bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <MarkdownView content={content} className="text-[0.95rem] leading-relaxed text-foreground" />
      </article>

      {(quality != null || spend || review || confidence || agents.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {quality != null && (
            <MetaChip icon={Gauge}>
              Quality {quality}/100
            </MetaChip>
          )}
          {confidence && (
            <MetaChip
              icon={ShieldCheck}
              tone={confidence.label === "high" ? "success" : confidence.label === "low" ? "warning" : "neutral"}
              title={confidence.reason}
            >
              Confidence {confidence.label} ({confidence.score}/100)
            </MetaChip>
          )}
          {spend && (
            <MetaChip icon={Coins} title={`${spend.remaining} of ${spend.budget} tokens left`}>
              Spent {spend.spent} tokens ({tokensWorthLabel(spend.spent)})
            </MetaChip>
          )}
          {review && (
            <MetaChip
              icon={review.approved ? CheckCircle2 : AlertTriangle}
              tone={review.approved ? "success" : "warning"}
              title={review.reworkRounds > 0 ? `${review.reworkRounds} rework round(s)` : undefined}
            >
              {review.approved ? "Review approved" : `${review.unresolvedIssues.length} unresolved issue(s)`}
              {review.reworkRounds > 0 ? ` after ${review.reworkRounds} rework round${review.reworkRounds > 1 ? "s" : ""}` : ""}
            </MetaChip>
          )}
          {agents.length > 0 && (
            <MetaChip icon={Users} title={agents.join(", ")}>
              Workforce: {agents.join(", ")}
            </MetaChip>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <Button variant="ghost" size="sm" onClick={handleCopy} className="h-8 gap-1.5 rounded-full text-muted-foreground transition-colors hover:text-foreground">
          {copied ? (
            <Check className="size-3.5 animate-in zoom-in-50 text-emerald-500 duration-200" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDownload} className="h-8 gap-1.5 rounded-full text-muted-foreground hover:text-foreground">
          <Download className="size-3.5" />
          Download
        </Button>
      </div>

      {review && !review.approved && review.unresolvedIssues.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">The final review still flags these issues after rework:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
            {review.unresolvedIssues.map((i, idx) => (
              <li key={idx}>
                <span className="font-medium text-foreground">{i.severity}</span> — {i.description}
              </li>
            ))}
          </ul>
        </div>
      )}
      {parsed.numeric_checks != null && <NumericChecksView report={parsed.numeric_checks as NumericCheckReport} />}
      {outputs.length > 0 && <WorkerOutputs outputs={outputs} />}
    </div>
  );
}

function MetaChip({
  icon: Icon,
  tone = "neutral",
  title,
  children,
}: {
  icon: typeof Gauge;
  tone?: "neutral" | "success" | "warning";
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        tone === "success"
          ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400"
          : tone === "warning"
            ? "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-400"
            : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

interface ReviewSummary {
  approved: boolean;
  score: number;
  reworkRounds: number;
  unresolvedIssues: Array<{ severity: string; description: string }>;
}

function fmt(n: number | null): string {
  if (n === null) return "-";
  return Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Math.round(n * 1000) / 1000);
}

// Result of lib/manager/numericCheck.ts: arithmetic the report claims,
// recomputed by deterministic code (not by a model).
function NumericChecksView({ report }: { report: NumericCheckReport }) {
  if (report.status === "unavailable" || report.checked === 0) return null;
  const flagged = report.checks.filter((c) => c.status !== "consistent");
  const allGood = flagged.length === 0;
  return (
    <details className="group rounded-2xl border border-border text-sm" open={!allGood}>
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-2.5">
        <span className="font-medium">Number check</span>
        <span className={allGood ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          {allGood
            ? `${report.consistent} of ${report.checked} calculations verified`
            : `${report.mismatches} of ${report.checked} calculations don't add up`}
        </span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="animate-in fade-in slide-in-from-top-1 space-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground duration-200">
        <p>The model listed the calculations the report states; each one was recomputed by deterministic code.</p>
        {flagged.length > 0 && (
          <ul className="space-y-2">
            {flagged.map((c, i) => (
              <li key={i} className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="font-medium text-foreground">{c.description}</div>
                <div className="font-mono text-[11px]">
                  {c.expression} = {fmt(c.computed)}
                  {c.status === "mismatch" ? ` - the report says ${fmt(c.claimed)}` : c.error ? ` (${c.error})` : ""}
                </div>
                <div className="mt-0.5 italic">&ldquo;{c.quote}&rdquo;</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// Each worker's own output, kept out of the report but available for anyone
// who wants to see exactly what every agent produced.
function WorkerOutputs({ outputs }: { outputs: WorkerOutput[] }) {
  return (
    <details className="group rounded-2xl border border-border text-sm">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-2.5">
        <span className="font-medium">How it was made</span>
        <span className="text-muted-foreground">{outputs.length} steps</span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="animate-in fade-in slide-in-from-top-1 space-y-2 border-t border-border p-3 duration-200">
        {outputs.map((o, i) => (
          <details key={i} className="group/step rounded-xl border border-border transition-colors">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <span className="font-medium text-foreground">{o.agentName ?? "Unassigned"}</span>
              <span>{o.type.replace(/_/g, " ")}</span>
              {o.qaScore != null && <span>· review score {o.qaScore}</span>}
              {o.attempts > 1 && <span>· {o.attempts} attempts</span>}
              <ChevronDown className="ml-auto size-3.5 transition-transform group-open/step:rotate-180" />
            </summary>
            <MarkdownView
              content={o.output}
              className="animate-in fade-in slide-in-from-top-1 border-t border-border px-4 py-3 text-xs text-muted-foreground duration-200"
            />
          </details>
        ))}
      </div>
    </details>
  );
}
