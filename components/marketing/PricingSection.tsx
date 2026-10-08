"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { LaunchConsoleButton } from "./LaunchConsoleButton";
import { PLANS } from "@/lib/billing/plans";

type Period = "monthly" | "yearly";

function formatINR(amount: number) {
  if (amount === 0) return "0";
  return amount.toLocaleString("en-IN");
}

export function PricingSection() {
  const [period, setPeriod] = useState<Period>("monthly");

  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">01 - Plans</p>
        <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
              Pricing that scales with your workforce.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Every plan runs the identical governed pipeline - discovery, ranking, escrow, QA,
              and payment. Nothing is stubbed at Starter. What scales per tier is how much your
              workforce is trusted to spend, how often you run it, and whether it gets to
              remember what worked last time.
            </p>
          </div>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 self-start border border-neutral-300 p-1 sm:self-auto dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setPeriod("monthly")}
              className={`px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                period === "monthly"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setPeriod("yearly")}
              className={`inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                period === "yearly"
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              Yearly
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9.5px] normal-case tracking-normal ${
                  period === "yearly"
                    ? "bg-white/15 text-white dark:bg-neutral-900/10 dark:text-neutral-900"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                }`}
              >
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Free-for-now banner */}
        <div className="mt-10 flex items-start gap-3 border border-neutral-900 bg-neutral-900 px-5 py-4 text-white sm:items-center dark:border-white dark:bg-white dark:text-neutral-900">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 sm:mt-0" />
          <p className="text-[13px] leading-relaxed text-white/80 dark:text-neutral-900/80">
            <strong className="font-semibold text-white dark:text-neutral-900">Kraven is free for everyone right now.</strong>{" "}
            Every plan below is unlocked at no cost while we&apos;re in early access. The prices
            shown are what each plan will cost after general availability, so you can plan ahead
            - we&apos;ll give advance notice before anything is charged.
          </p>
        </div>

        {/* Why pricing scales this way */}
        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden border border-neutral-200 bg-neutral-200 sm:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-800">
          {[
            {
              k: "Spend ceiling",
              v: "The budget a tier authorizes per task is the exact number the Circuit Breaker enforces - a higher tier is more blast radius you trust the workforce with, not a seat count.",
            },
            {
              k: "Throughput",
              v: "Tasks per month caps how many governed runs - full discovery through payment - you can execute, independent of how big any single task's budget is.",
            },
            {
              k: "Compounding memory",
              v: "Workflow Memory and Optimization Gain reporting only pay off on repeat tasks, so they unlock at Growth and above rather than sitting unused on a trial.",
            },
          ].map((item) => (
            <div key={item.k} className="bg-white px-6 py-5 dark:bg-neutral-950">
              <p className="font-mono text-[10.5px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{item.k}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-400">{item.v}</p>
            </div>
          ))}
        </div>

        {/* Plan cards */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const price = period === "monthly" ? plan.monthly : plan.yearly;
            const perMonthEquivalent = period === "yearly" && plan.yearly > 0 ? Math.round(plan.yearly / 12) : null;

            return (
              <div
                key={plan.name}
                className={`relative flex flex-col border p-7 ${
                  plan.highlight
                    ? "border-neutral-900 shadow-[6px_6px_0_0_theme(colors.neutral.100)] dark:border-white dark:shadow-[6px_6px_0_0_theme(colors.neutral.800)]"
                    : "border-neutral-200 dark:border-neutral-800"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-7 border border-neutral-900 bg-white px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-900 dark:border-white dark:bg-neutral-950 dark:text-neutral-50">
                    Most popular
                  </span>
                )}

                <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{plan.name}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">{plan.tagline}</p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-mono text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
                    ₹{formatINR(price)}
                  </span>
                  <span className="text-[13px] text-neutral-400 dark:text-neutral-500">
                    {price === 0 ? "forever" : period === "monthly" ? "/ month" : "/ year"}
                  </span>
                </div>
                {perMonthEquivalent !== null && (
                  <p className="mt-1 text-[12px] text-neutral-400 dark:text-neutral-500">≈ ₹{formatINR(perMonthEquivalent)} / month, billed yearly</p>
                )}
                <p className="mt-2 inline-flex w-fit items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                  Free during early access
                </p>

                <ul className="mt-7 flex flex-1 flex-col gap-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-neutral-600 dark:text-neutral-400">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2.25} />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <LaunchConsoleButton
                    label="Get started free"
                    className={`w-full ${plan.highlight ? "" : "!border-neutral-300 !bg-white !text-neutral-900 hover:!bg-neutral-50 dark:!border-neutral-700 dark:!bg-neutral-950 dark:!text-neutral-50 dark:hover:!bg-neutral-900"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-[12.5px] text-neutral-400 dark:text-neutral-500">
          Need a custom budget cap, on-prem deployment, or a different capability mix? {" "}
          <a href="/contact" className="text-neutral-700 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
            Talk to us
          </a>
          .
        </p>
      </div>
    </section>
  );
}
