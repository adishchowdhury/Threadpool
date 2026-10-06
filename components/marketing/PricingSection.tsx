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
        <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">01 - Plans</p>
        <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
              Pricing that scales with your workforce.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-neutral-500">
              Every plan runs the same governed pipeline - discovery, ranking, escrow, QA, and
              payment. Higher tiers raise how much your workforce can spend and how much of it
              you can run at once.
            </p>
          </div>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 self-start border border-neutral-300 p-1 sm:self-auto">
            <button
              type="button"
              onClick={() => setPeriod("monthly")}
              className={`px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                period === "monthly" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setPeriod("yearly")}
              className={`inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                period === "yearly" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              Yearly
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9.5px] normal-case tracking-normal ${
                  period === "yearly" ? "bg-white/15 text-white" : "bg-amber-100 text-amber-800"
                }`}
              >
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Free-for-now banner */}
        <div className="mt-10 flex items-start gap-3 border border-neutral-900 bg-neutral-900 px-5 py-4 text-white sm:items-center">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 sm:mt-0" />
          <p className="text-[13px] leading-relaxed text-white/80">
            <strong className="font-semibold text-white">Kraven is free for everyone right now.</strong>{" "}
            Every plan below is unlocked at no cost while we&apos;re in early access. The prices
            shown are what each plan will cost after general availability, so you can plan ahead
            - we&apos;ll give advance notice before anything is charged.
          </p>
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
                  plan.highlight ? "border-neutral-900 shadow-[6px_6px_0_0_theme(colors.neutral.100)]" : "border-neutral-200"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-7 border border-neutral-900 bg-white px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-900">
                    Most popular
                  </span>
                )}

                <h3 className="text-lg font-semibold text-neutral-900">{plan.name}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">{plan.tagline}</p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-mono text-3xl font-semibold text-neutral-900">
                    ₹{formatINR(price)}
                  </span>
                  <span className="text-[13px] text-neutral-400">
                    {price === 0 ? "forever" : period === "monthly" ? "/ month" : "/ year"}
                  </span>
                </div>
                {perMonthEquivalent !== null && (
                  <p className="mt-1 text-[12px] text-neutral-400">≈ ₹{formatINR(perMonthEquivalent)} / month, billed yearly</p>
                )}
                <p className="mt-2 inline-flex w-fit items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                  Free during early access
                </p>

                <ul className="mt-7 flex flex-1 flex-col gap-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-neutral-600">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-neutral-400" strokeWidth={2.25} />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <LaunchConsoleButton
                    label="Get started free"
                    className={`w-full ${plan.highlight ? "" : "!border-neutral-300 !bg-white !text-neutral-900 hover:!bg-neutral-50"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-[12.5px] text-neutral-400">
          Need a custom budget cap, on-prem deployment, or a different capability mix? {" "}
          <a href="/contact" className="text-neutral-700 underline underline-offset-2 hover:text-neutral-900">
            Talk to us
          </a>
          .
        </p>
      </div>
    </section>
  );
}
