// Shared plan catalog - the single source of truth for both the public
// Pricing page (components/marketing/PricingSection.tsx) and the console's
// Profile page. Kraven doesn't bill anyone yet (CLAUDE.md: no real billing
// during the hackathon build) - every account is actually on Starter, free,
// while in early access. These numbers describe what the plan WILL cap once
// billing goes live; they aren't enforced server-side today.
//
// PRICING STRATEGY (see also the "why pricing works this way" strip on
// /pricing). Kraven is not priced per-seat or per-message - every tier runs
// the identical governed pipeline (discovery -> ranking -> escrow -> QA ->
// payment). What changes per tier is scaled along the product's actual USPs,
// not arbitrary feature-gating:
//
//   1. Spend ceiling per task (maxBudgetPerTask) - this is literally the
//      number the Circuit Breaker authorizes against. A higher tier is a
//      wider blast radius you trust the workforce with per task, which is
//      why it's the primary axis instead of a generic "seats" count.
//   2. Throughput (tasksPerMonth) - how many governed runs you can execute.
//   3. Compounding intelligence - Workflow Memory (reuse/adapt past
//      workflows) and Optimization Gain reporting only pay off with repeat
//      usage, so they're gated to Growth+ as the upgrade driver rather than
//      bundled into Starter where they'd go unused.
//   4. Org-scale trust & operations - audit export, custom marketplace
//      agents, dedicated capacity and team seats are Scale-only because they
//      serve agencies/orgs governing spend across multiple clients, not
//      individual task budgets.
//
// Starter exists to prove the trust layer (escrow/ledger/Circuit Breaker)
// works on a real task, not to be a crippled trial - nothing in the
// governed pipeline is stubbed at any tier.
export interface Plan {
  id: "starter" | "growth" | "scale";
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  highlight?: boolean;
  features: string[];
  // null = no cap at this tier.
  maxBudgetPerTask: number | null;
  tasksPerMonth: number | null;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Prove the governed pipeline on real tasks before you commit.",
    monthly: 0,
    yearly: 0,
    maxBudgetPerTask: 50,
    tasksPerMonth: 5,
    features: [
      "Up to 50 tokens authorized per task (Circuit Breaker ceiling)",
      "5 tasks per month",
      "Full discovery -> ranking -> escrow -> QA -> payment pipeline - nothing stubbed",
      "Escrow, ledger & Circuit Breaker enforced on every run",
      "Community support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For builders who run Kraven regularly and want it to get cheaper and faster over time.",
    monthly: 1999,
    yearly: 19990,
    highlight: true,
    maxBudgetPerTask: 500,
    tasksPerMonth: 100,
    features: [
      "Up to 500 tokens authorized per task",
      "100 tasks per month",
      "Workflow Memory - reuse & adapt past workflows instead of rebuilding from scratch",
      "Optimization Gain reporting - see cost/quality vs. a naive workflow",
      "Priority agent routing & faster QA turnaround",
      "Email support within 1 business day",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "For agencies and teams governing AI spend across multiple clients.",
    monthly: 7999,
    yearly: 79990,
    maxBudgetPerTask: null,
    tasksPerMonth: null,
    features: [
      "Unlimited per-task budget (org-level cap you set)",
      "Unlimited tasks per month",
      "Bring your own agents via the marketplace provider API",
      "Dedicated agent capacity - no queueing behind other tenants",
      "Full audit export - every ledger entry, QA review & security event",
      "Team seats & priority support with a dedicated contact",
    ],
  },
];

// Every account is on this plan during early access.
export const CURRENT_PLAN_ID: Plan["id"] = "starter";

export function getPlan(id: Plan["id"]): Plan {
  return PLANS.find((p) => p.id === id)!;
}
