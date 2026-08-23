import React from "react";
import { Terminal, CheckCircle2, AlertTriangle, Cpu, HelpCircle, Layers } from "lucide-react";
import { type OptimizedTask } from "@/lib/optimizer/types";

import type { TaskRecord } from "@/lib/types";

interface PromptOptimizationPanelProps {
  task: TaskRecord | null;
}

export function PromptOptimizationPanel({ task }: PromptOptimizationPanelProps) {
  if (!task) return null;

  // Mode A (Raw execution) layout
  if (task.optimizationMode === "A") {
    return (
      <div className="absolute top-20 left-4 z-20 w-80 rounded-xl border border-panel-border bg-panel/85 p-4 shadow-2xl backdrop-blur-xl transition-all duration-300">
        <div className="flex items-center gap-2 border-b border-panel-border pb-2.5">
          <Terminal className="size-4 text-panel-muted" />
          <h3 className="font-semibold text-xs text-panel-foreground tracking-wider uppercase">RAW EXECUTION (MODE A)</h3>
        </div>
        <div className="mt-3">
          <p className="text-[11px] text-panel-muted uppercase font-medium">Original Prompt</p>
          <p className="mt-1 text-sm font-mono text-panel-foreground bg-panel-elevated/40 p-2.5 rounded border border-panel-border/30">
            "{task.prompt}"
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded bg-amber-500/10 p-2 border border-amber-500/20 text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="text-[10px] font-medium leading-tight">No optimization applied. Sending directly to Gemini Manager.</span>
        </div>
      </div>
    );
  }

  // Mode B (Optimized execution) layout
  let optimizedSpec: OptimizedTask | null = null;
  if (task.optimizedTaskSpec) {
    try {
      optimizedSpec = JSON.parse(task.optimizedTaskSpec);
    } catch {}
  }

  return (
    <div className="absolute top-20 left-4 z-20 w-88 rounded-xl border border-panel-border bg-panel/90 p-4 shadow-2xl backdrop-blur-xl transition-all duration-300 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between border-b border-panel-border pb-2.5">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-accent-strong" />
          <h3 className="font-bold text-xs text-panel-foreground tracking-wider uppercase">PROMPT COMPILER (MODE B)</h3>
        </div>
        {task.isOptimized ? (
          <span className="rounded-full bg-accent-strong/10 border border-accent-strong/20 px-2 py-0.5 text-[9px] font-bold text-accent-strong uppercase">
            Optimized
          </span>
        ) : (
          <span className="rounded-full bg-panel-elevated border border-panel-border px-2 py-0.5 text-[9px] font-bold text-panel-muted uppercase animate-pulse">
            Compiling...
          </span>
        )}
      </div>

      <div className="mt-3">
        <p className="text-[10px] text-panel-muted uppercase font-semibold">User Input</p>
        <p className="mt-1 text-xs font-mono text-panel-foreground bg-panel-elevated/40 p-2 rounded border border-panel-border/20">
          "{task.prompt}"
        </p>
      </div>

      {optimizedSpec && (
        <div className="mt-4 space-y-3.5">
          {/* Objective */}
          <div>
            <p className="text-[10px] text-panel-muted uppercase font-semibold">Target Objective</p>
            <p className="mt-1 text-xs text-panel-foreground leading-normal font-medium">
              {optimizedSpec.objective}
            </p>
          </div>

          {/* Model info */}
          <div className="flex flex-col gap-2 bg-panel-elevated/35 p-3 rounded-lg border border-panel-border/30 text-[11px] text-panel-muted">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Layers className="size-3.5 text-panel-muted" /> Model:</span>
              <strong className="text-panel-foreground">{task.optimizerModel || "Qwen3-0.6B"}</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Cpu className="size-3.5 text-panel-muted" /> Provider:</span>
              <strong className="text-panel-foreground">{task.optimizerModel === "gemini-fallback" ? "Gemini Fallback" : "Local"}</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Cpu className="size-3.5 text-panel-muted" /> Mode:</span>
              <strong className="text-panel-foreground">Non-thinking</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Cpu className="size-3.5 text-panel-muted" /> Inference Latency:</span>
              <strong className="text-panel-foreground">{task.optimizerLatencyMs}ms</strong>
            </div>
          </div>

          {/* Ambiguities */}
          {optimizedSpec.ambiguities.length > 0 && (
            <div>
              <p className="text-[10px] text-panel-muted uppercase font-semibold flex items-center gap-1">
                <HelpCircle className="size-3 text-amber-500" /> Detected Ambiguities
              </p>
              <ul className="mt-1 space-y-1">
                {optimizedSpec.ambiguities.map((amb, i) => (
                  <li key={i} className="text-[11px] text-amber-400 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/10 flex items-start gap-1">
                    <span className="mt-0.5">•</span>
                    <span>{amb}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verification requirements */}
          {optimizedSpec.verificationRequirements && (
            <div>
              <p className="text-[10px] text-panel-muted uppercase font-semibold flex items-center gap-1">
                <CheckCircle2 className="size-3 text-accent-strong" /> Verification Rules
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {optimizedSpec.verificationRequirements.required && (
                  <span className="rounded bg-accent-strong/10 border border-accent-strong/20 px-1.5 py-0.5 text-[9px] font-bold text-accent-strong">
                    VERIFICATION REQUIRED
                  </span>
                )}
                {optimizedSpec.verificationRequirements.sourceGrounding && (
                  <span className="rounded bg-accent-strong/10 border border-accent-strong/20 px-1.5 py-0.5 text-[9px] font-bold text-accent-strong">
                    SOURCE GROUNDING
                  </span>
                )}
                {optimizedSpec.verificationRequirements.externalValidation && (
                  <span className="rounded bg-accent-strong/10 border border-accent-strong/20 px-1.5 py-0.5 text-[9px] font-bold text-accent-strong">
                    EXTERNAL API VALIDATION
                  </span>
                )}
                {optimizedSpec.verificationRequirements.crossAgentVerification && (
                  <span className="rounded bg-accent-strong/10 border border-accent-strong/20 px-1.5 py-0.5 text-[9px] font-bold text-accent-strong">
                    CROSS AGENT VERIFICATION
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
