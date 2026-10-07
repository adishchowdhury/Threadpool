import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { LaunchConsoleButton } from "@/components/marketing/LaunchConsoleButton";
import { PricingSection } from "@/components/marketing/PricingSection";
import { ScaleDivider } from "@/components/home/ScaleDivider";

export const metadata = {
  title: "Pricing - Kraven",
  description:
    "Simple, transparent pricing for the Kraven AI workforce platform. Free for everyone during early access, with monthly and yearly plans in INR for when general availability launches.",
};

const FAQ = [
  {
    q: "I already pay for ChatGPT Plus or Claude Pro - why would I pay for this too?",
    a: "Those subscriptions cap what you can ask, not what a task costs or whether the answer was checked. Kraven's budget is per task - it caps what the AI workforce is allowed to spend to finish one deliverable, runs an independent QA pass before anything is paid, and never lets an agent spend past what it was authorized for. You're paying for governed, verified multi-agent work, not another seat at a chat window.",
  },
  {
    q: "Is Kraven really free right now?",
    a: "Yes. Every plan - including Growth and Scale features - is unlocked at no cost while Kraven is in early access. We'll announce billing well in advance before any plan starts charging.",
  },
  {
    q: "What counts as a “task”?",
    a: "One task is one objective you give the Manager agent - for example, a market analysis, a competitive report, or a financial summary - regardless of how many agents it takes to complete it.",
  },
  {
    q: "What happens if I go over my monthly tasks?",
    a: "Kraven will tell you before a task starts if it would put you over your plan's limit, so you're never charged or blocked without warning. You can upgrade at any time.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes, you can move between plans at any time from your account. Changes apply to your next billing cycle once paid plans go live.",
  },
];

export default function PricingPage() {
  return (
    <MarketingLayout>
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20 lg:pt-24">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Pricing</p>
          <h1 className="mt-3 max-w-2xl text-left text-[26px] font-medium leading-[1.2] tracking-[-0.01em] text-neutral-900 sm:text-4xl lg:text-[2.6rem] xl:text-[2.9rem]">
            One budget. One bill.
            <br />
            No surprises either way.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-neutral-500 sm:text-base">
            Kraven prices around how much your AI workforce can spend, not per-seat or
            per-message. Pick a plan, set your per-task budget, and every run is governed the
            same way - escrow first, payment only after QA passes.
          </p>
        </div>
      </section>

      <PricingSection />

      <ScaleDivider />

      {/* ─── FAQ ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">02 - FAQ</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            Questions, answered.
          </h2>

          <div className="mt-10 divide-y divide-neutral-200 border-t border-neutral-200">
            {FAQ.map((item) => (
              <div key={item.q} className="py-6">
                <h3 className="text-[15px] font-semibold text-neutral-900">{item.q}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-500">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── CTA ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="mx-auto max-w-2xl text-[26px] font-medium leading-[1.2] tracking-[-0.01em] text-neutral-900 sm:text-4xl lg:text-[2.6rem] xl:text-[2.9rem]">
            Start free. Upgrade when you need more.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-neutral-500">
            No credit card required during early access.
          </p>
          <div className="mt-9 flex justify-center">
            <LaunchConsoleButton />
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
