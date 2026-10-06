// Shared plan catalog - the single source of truth for both the public
// Pricing page (components/marketing/PricingSection.tsx) and the console's
// Profile page. Kraven doesn't bill anyone yet (CLAUDE.md: no real billing
// during the hackathon build) - every account is actually on Starter, free,
// while in early access. These numbers describe what the plan WILL cap once
// billing goes live; they aren't enforced server-side today.
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
    tagline: "Try Kraven on real tasks with no commitment.",
    monthly: 0,
    yearly: 0,
    maxBudgetPerTask: 50,
    tasksPerMonth: 5,
    features: [
      "Up to 50 tokens of budget per task",
      "5 tasks per month",
      "Full discovery, ranking & QA pipeline",
      "Escrow, ledger & Circuit Breaker included",
      "Community support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For founders and small teams shipping regularly.",
    monthly: 1999,
    yearly: 19990,
    highlight: true,
    maxBudgetPerTask: 500,
    tasksPerMonth: 100,
    features: [
      "Up to 500 tokens of budget per task",
      "100 tasks per month",
      "Priority agent routing & faster QA turnaround",
      "Workflow memory & reuse across tasks",
      "Email support within 1 business day",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    tagline: "For agencies and teams running Kraven across clients.",
    monthly: 7999,
    yearly: 79990,
    maxBudgetPerTask: null,
    tasksPerMonth: null,
    features: [
      "Unlimited budget per task (org-level cap)",
      "Unlimited tasks per month",
      "Dedicated agent capacity & custom marketplace agents",
      "Full audit export & team seats",
      "Priority support with a dedicated contact",
    ],
  },
];

// Every account is on this plan during early access.
export const CURRENT_PLAN_ID: Plan["id"] = "starter";

export function getPlan(id: Plan["id"]): Plan {
  return PLANS.find((p) => p.id === id)!;
}
