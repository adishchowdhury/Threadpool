import { Check, ChevronDown, ChevronUp, X } from "lucide-react";

type Step = {
  title: string;
  agent?: string;
  tokens?: number;
  sub: (attempt?: number) => string;
  attempts?: number;
  why?: string;
  outcome: "done" | "blocked";
};

/* The default "fintech market analysis" demo run, grounded in the real
   pipeline: understanding → discovery/ranking → escrow → QA → payment. */
const STEPS: Step[] = [
  {
    title: "Understanding the task",
    sub: () => "Split into 5 steps · reusing what worked on a similar task (94% match)",
    outcome: "done",
  },
  {
    title: "Market research",
    agent: "Atlas Researcher",
    tokens: 3,
    sub: () => "Approved · review score 95/100",
    why: "Highest capability match for market_research at 91 reputation.",
    outcome: "done",
  },
  {
    title: "Rogue demo",
    agent: "Rogue Agent",
    tokens: 10000,
    sub: () => "Blocked — requested 10,000, authorized 3. Ledger unchanged.",
    outcome: "blocked",
  },
  {
    title: "Financial analysis",
    agent: "Beacon Insights",
    tokens: 4,
    sub: (a) => `Approved · review score 89/100${a ? ` · after ${a} attempts` : ""}`,
    attempts: 2,
    why: "Best cost-to-quality ratio among budget-compatible candidates.",
    outcome: "done",
  },
  {
    title: "Report generation",
    agent: "Nova Writer",
    tokens: 3,
    sub: () => "Approved · review score 92/100",
    why: "Strong track record on investment-style report synthesis.",
    outcome: "done",
  },
  {
    title: "Quality verification",
    agent: "Guardian QA",
    tokens: 5,
    sub: () => "Approved · review score 95/100",
    why: "Independent reviewer — never the same agent as the worker.",
    outcome: "done",
  },
];

const AGENT_COUNT = new Set(STEPS.map((s) => s.agent).filter(Boolean)).size;

export function HeroSimulation() {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl p-px">
      <div
        className="absolute inset-[-150%] animate-[spin_7s_linear_infinite]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0%, oklch(0.82 0.14 85 / 0.9) 8%, transparent 18%, transparent 50%, oklch(0.2 0 0 / 0.5) 58%, transparent 68%, transparent 100%)",
        }}
      />
      <div className="relative w-full rounded-[calc(1rem-1px)] border border-neutral-200/60 bg-white px-6 py-5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <span className="flex items-center gap-2 text-[14.5px] font-medium text-neutral-900">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="size-3" strokeWidth={3} />
            </span>
            {STEPS.length} steps · {AGENT_COUNT} agents
          </span>
          <ChevronUp className="size-4 text-neutral-300" />
        </div>

        <ol className="pt-1">
          {STEPS.map((step, i) => {
            const isLast = i === STEPS.length - 1;
            return (
              <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
                {!isLast && (
                  <span
                    className="absolute top-6 left-2.75 w-px bg-neutral-200"
                    style={{ bottom: 0 }}
                  />
                )}
                <span
                  className={`relative z-10 mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full border ${
                    step.outcome === "blocked"
                      ? "border-red-200 bg-red-50 text-red-500"
                      : "border-emerald-200 bg-emerald-50 text-emerald-600"
                  }`}
                >
                  {step.outcome === "done" && <Check className="size-3" strokeWidth={3} />}
                  {step.outcome === "blocked" && <X className="size-3" strokeWidth={3} />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] leading-snug text-neutral-900">
                    <span className="font-medium">{step.title}</span>
                    {step.agent && (
                      <span className="text-neutral-400">
                        {" "}
                        {step.agent} · {step.tokens?.toLocaleString()} token{step.tokens === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                  <p
                    className={`mt-0.5 text-[13px] leading-snug ${
                      step.outcome === "blocked" ? "text-red-500" : "text-neutral-400"
                    }`}
                  >
                    {step.sub(step.attempts)}
                  </p>
                  {step.why && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-neutral-300">
                      Why this agent?
                      <ChevronDown className="size-3" />
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
