"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Workflow,
  Search,
  Lock,
  ShieldAlert,
  CheckCheck,
  History,
  ArrowRight,
  ArrowDown,
  ClipboardList,
  Sparkles,
  SlidersHorizontal,
  Play,
  ShieldCheck,
  Wallet,
  Users,
  LayoutGrid,
  Tags,
  Check,
  X,
  FileCheck2,
} from "lucide-react";
import { ScaleDivider, VerticalScaleBars } from "./ScaleDivider";
import { HeroSimulation } from "./HeroSimulation";
import { ScrambleText, useHoverScramble } from "./ScrambleText";
import { SiteNavLinks } from "@/components/marketing/SiteNavLinks";
import { FooterLinks } from "@/components/marketing/FooterLinks";
import { MobileNav } from "@/components/marketing/MobileNav";
import { LoginDialog } from "@/components/auth/login-dialog";
import { firebaseConfigured } from "@/lib/firebase";
import { useAuthUser } from "@/lib/use-auth-user";
import { ROSTER } from "@/lib/agents/roster";
import { CAPABILITY_IDS, CAPABILITY_CATALOG } from "@/lib/capabilities/catalog";

const PIPELINE_STEPS = [
  { label: "Task", desc: "Objective + budget", icon: ClipboardList },
  { label: "Manager", desc: "Sarvam AI decomposes it", icon: Sparkles },
  { label: "Discover", desc: "Search the marketplace", icon: Search },
  { label: "Rank", desc: "Score every candidate", icon: SlidersHorizontal },
  { label: "Escrow", desc: "Lock the budget", icon: Lock },
  { label: "Execute", desc: "Agents do the work", icon: Play },
  { label: "QA", desc: "Independent review", icon: ShieldCheck },
  { label: "Pay", desc: "Release on approval", icon: Wallet },
];

const WORKFORCE_STATS = [
  { value: ROSTER.length, label: "Agents live in the registry", icon: Users },
  { value: CAPABILITY_IDS.length, label: "Capability areas covered", icon: LayoutGrid },
  {
    value: new Set(ROSTER.map((a) => a.tier)).size,
    label: "Pricing tiers per capability",
    icon: Tags,
  },
];

const CAPABILITY_CHIPS = CAPABILITY_IDS.map((id) => CAPABILITY_CATALOG[id].label);

const COMPARISON_ROWS = [
  "Splits the task into a research → analysis → writing → QA pipeline for you",
  "Every number comes back tagged as observed (cited) or estimate",
  "A hard budget is enforced before any work starts - not just a token limit",
  "A reviewer independent from the writer scores the output before you see it",
  "Failing work is never paid and never counted toward reputation",
  "Every task leaves an audit trail: who did what, what it cost, how it was checked",
];

const EXAMPLE_TASKS = [
  {
    title: "Fintech market-entry report",
    budget: "50 tokens",
    pipeline: "Web research → Market + competitive + financial analysis → Risk → Report → QA",
    outcome: "A cited, investment-style report with segments, unit economics, and a risk section - not a single ungrounded answer.",
  },
  {
    title: "Competitor pricing & positioning scan",
    budget: "~15 tokens",
    pipeline: "Competitive analysis → Data extraction → Review",
    outcome: "A structured comparison table of named competitors on price, features, and positioning.",
  },
  {
    title: "Regulatory exposure check before launch",
    budget: "~20 tokens",
    pipeline: "Regulatory & compliance → Risk assessment → Review",
    outcome: "A sourced rundown of applicable rules and licensing requirements for the target market.",
  },
];

const FEATURES = [
  {
    icon: Workflow,
    title: "Task understanding",
    desc: "Sarvam decomposes an objective and budget into required capabilities and a subtask dependency graph - never freeform guesswork.",
  },
  {
    icon: Search,
    title: "Agent marketplace",
    desc: "Discovers, filters, and ranks worker agents by capability, quality, cost, latency, and reputation. Never selected on price alone.",
  },
  {
    icon: Lock,
    title: "Escrow & ledger",
    desc: "Payment is locked in escrow before work starts and released only after independent verification. Integer tokens, atomic transactions.",
  },
  {
    icon: ShieldAlert,
    title: "Circuit breaker",
    desc: "Deterministic checks run on every sensitive operation. Oversized or unauthorized transfers are rejected before the ledger changes.",
  },
  {
    icon: CheckCheck,
    title: "QA verification",
    desc: "A QA agent independent from the worker scores every deliverable. Failing work is never paid and never raises reputation.",
  },
  {
    icon: History,
    title: "Reputation & memory",
    desc: "Every execution is recorded. Past cost, quality, and latency inform how the next workforce is assembled.",
  },
];

export function HomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthUser();
  const [loginOpen, setLoginOpen] = useState(false);
  const navLaunch = useHoverScramble();
  const heroLaunch = useHoverScramble();
  const heroPipeline = useHoverScramble();
  const footerLaunch = useHoverScramble();

  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "auto";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  function handleLaunch(e: React.MouseEvent) {
    e.preventDefault();
    if (firebaseConfigured && !authLoading && !user) {
      setLoginOpen(true);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="bg-white text-neutral-900 lg:px-4">
      <VerticalScaleBars />
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={() => router.push("/dashboard")}
      />
      {/* ─── NAV ─── */}
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/logo.png"
              alt="Kraven"
              width={2172}
              height={724}
              className="h-9 w-auto"
              priority
            />
          </Link>

          <nav className="hidden items-center gap-5 font-mono text-[10.5px] uppercase tracking-wider text-neutral-400 xl:flex">
            <SiteNavLinks linkClassName="transition-colors hover:text-neutral-900" />
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/dashboard"
              onClick={handleLaunch}
              onMouseEnter={navLaunch.onMouseEnter}
              onMouseLeave={navLaunch.onMouseLeave}
              className="inline-flex h-8 items-center gap-1.5 border border-neutral-900 bg-neutral-900 px-3.5 font-mono text-[12px] uppercase tracking-wider text-white transition-colors hover:bg-neutral-800"
            >
              <ScrambleText text="Launch console" active={navLaunch.hovered} />
              <ArrowRight className="size-3.5" />
            </Link>
            <MobileNav />
          </div>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:pt-24">
          <div className="flex flex-col items-center gap-8 text-center">
            <h1 className="max-w-4xl text-[22px] font-medium leading-[1.2] tracking-[-0.01em] text-neutral-900 sm:text-[2rem] sm:whitespace-nowrap lg:text-[2.3rem] xl:text-[2.5rem]">
              Hire an AI{" "}
              <span className="relative inline-block whitespace-nowrap">
                <span
                  aria-hidden
                  className="absolute inset-x-[-0.08em] bottom-[0.08em] -z-10 h-[0.42em] -rotate-1 bg-amber-300/80"
                />
                <span className="font-(family-name:--font-accent) text-[1.35em] italic tracking-normal">
                  workforce
                </span>
              </span>
              {" "}- paid only when it{" "}
              <span className="relative inline-block whitespace-nowrap">
                <span
                  aria-hidden
                  className="absolute inset-x-[-0.08em] bottom-[0.08em] -z-10 h-[0.42em] rotate-1 bg-amber-300/80"
                />
                <span className="font-(family-name:--font-accent) text-[1.35em] italic tracking-normal">
                  passes QA
                </span>

                {/* v1 scope tag */}
                <span className="anim-spring-pop absolute left-full bottom-[calc(100%+0.625rem)] inline-flex items-center whitespace-nowrap border border-neutral-200 bg-white px-2.5 py-1 font-mono text-[9px] font-normal not-italic uppercase tracking-wider text-neutral-500 shadow-sm">
                  <span
                    aria-hidden
                    className="absolute -bottom-1.25 left-3 size-2 rotate-45 border-r border-b border-neutral-200 bg-white"
                  />
                  v1 - text in, text out
                </span>
              </span>
              .
            </h1>

            <p className="max-w-xl text-[15px] leading-relaxed text-neutral-500 sm:text-base">
              Kraven discovers, ranks, and hires agents for your task from a live
              marketplace - then locks your budget in escrow and releases it
              only after an independent reviewer approves the work.
            </p>

            <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
              <Link
                href="/dashboard"
                onClick={handleLaunch}
                onMouseEnter={heroLaunch.onMouseEnter}
                onMouseLeave={heroLaunch.onMouseLeave}
                className="inline-flex h-11 w-full items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 px-5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 sm:w-auto"
              >
                <ScrambleText text="Launch console" active={heroLaunch.hovered} />
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#pipeline"
                onMouseEnter={heroPipeline.onMouseEnter}
                onMouseLeave={heroPipeline.onMouseLeave}
                className="inline-flex h-11 w-full items-center justify-center gap-2 border border-neutral-300 px-5 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 sm:w-auto"
              >
                <ScrambleText text="See the pipeline" active={heroPipeline.hovered} />
                <ArrowDown className="size-4" />
              </a>
            </div>
          </div>

          <div className="mt-12 sm:mt-16">
            <HeroSimulation />
          </div>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── PIPELINE ─── */}
      <section id="pipeline" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            01 - Pipeline
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            One task. A governed pipeline.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-500">
            Nothing about the workforce is fixed in advance. Every step is
            discovered, scored, and enforced at run time.
          </p>

          {/* mobile / tablet: vertical timeline */}
          <ol className="mt-12 lg:hidden">
            {PIPELINE_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isLast = i === PIPELINE_STEPS.length - 1;
              return (
                <li key={step.label} className="relative flex gap-4 pb-8 last:pb-0">
                  {!isLast && (
                    <span className="absolute top-11 bottom-0 left-5.25 w-px bg-neutral-200" aria-hidden />
                  )}
                  <div className="relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm">
                    <Icon className="size-4.5" />
                  </div>
                  <div className="pt-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-neutral-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[15px] font-semibold text-neutral-900">{step.label}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-neutral-500">{step.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* desktop: horizontal stepper */}
          <div className="relative mt-14 hidden lg:grid lg:grid-cols-8">
            <div className="absolute inset-x-0 top-6 h-px bg-neutral-200" aria-hidden />
            {PIPELINE_STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="relative flex flex-col items-center px-2 text-center">
                  <div className="relative z-10 flex size-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm">
                    <Icon className="size-5" />
                  </div>
                  <span className="mt-3 font-mono text-[10.5px] text-neutral-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="mt-0.5 text-[13.5px] font-semibold text-neutral-900">{step.label}</span>
                  <span className="mt-0.5 text-[11.5px] text-neutral-400">{step.desc}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── CAPABILITIES ─── */}
      <section id="capabilities" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            02 - Capabilities
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            Built for governed autonomy.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-500">
            For anyone who needs an AI task finished inside a hard budget -
            founders scoping a report, ops teams capping agent spend,
            reviewers auditing the chain of custody.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-px border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            {WORKFORCE_STATS.map((stat) => (
              <div key={stat.label} className="flex items-start gap-4 bg-white px-6 py-6">
                <stat.icon
                  className="mt-0.5 size-5 shrink-0 text-neutral-400"
                  strokeWidth={1.75}
                />
                <div>
                  <p className="font-mono text-2xl font-semibold text-neutral-900 sm:text-3xl">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-snug text-neutral-500">
                    {stat.label}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            v1 - text in, text out
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-6xl border border-neutral-200">
          {[FEATURES.slice(0, 3), FEATURES.slice(3, 6)].map((row, ri) => (
            <div
              key={ri}
              className={[
                "grid grid-cols-1 divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0",
                ri === 1 ? "border-t border-neutral-200" : "",
              ].join(" ")}
            >
              {row.map((f) => (
                <div
                  key={f.title}
                  className="group p-7 transition-colors duration-200 hover:bg-neutral-50"
                >
                  <div className="flex size-10 items-center justify-center border border-neutral-200 bg-white transition-colors duration-200 group-hover:border-neutral-900">
                    <f.icon
                      className="size-4.5 text-neutral-900 transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:rotate-6"
                      strokeWidth={1.75}
                    />
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold text-neutral-900">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-6xl px-6">
          <div className="border border-neutral-200 bg-neutral-50/70 px-6 py-7 sm:px-8">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
                Hireable for
              </p>
              <p className="font-mono text-[11px] text-neutral-400">
                {CAPABILITY_CHIPS.length} capabilities
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {CAPABILITY_CHIPS.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center border border-neutral-300 bg-white px-3 py-1.5 font-mono text-[12px] text-neutral-700 transition-colors duration-150 hover:border-neutral-900 hover:text-neutral-900"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── DIFFERENTIATION ─── */}
      <section id="why-not-chat" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            03 - Not a chat window
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            ChatGPT answers. Kraven delivers, verified, under a budget.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-neutral-500">
            A chat tab gives you one model&apos;s best guess, and you&apos;re the one who has
            to decompose the task, check the numbers, and decide if it&apos;s good enough.
            Kraven runs that whole loop as a governed, paid pipeline - and only charges you
            for work that actually passes.
          </p>

          <div className="mt-10 border border-neutral-200">
            <div className="hidden grid-cols-[1fr_auto_auto] border-b border-neutral-200 bg-neutral-50 px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-neutral-400 sm:grid">
              <span />
              <span className="w-32 px-4 text-center">ChatGPT / Claude chat</span>
              <span className="w-32 px-4 text-center">Kraven</span>
            </div>
            {COMPARISON_ROWS.map((row, i) => (
              <div
                key={row}
                className={[
                  "grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:border-neutral-200",
                  i !== 0 ? "border-t border-neutral-200" : "",
                ].join(" ")}
              >
                <p className="text-[13.5px] leading-snug text-neutral-700">{row}</p>
                <span className="hidden w-32 items-center justify-center px-4 sm:flex">
                  <X className="size-4 text-neutral-300" strokeWidth={2.25} />
                </span>
                <span className="flex w-10 items-center justify-center sm:w-32 sm:px-4">
                  <Check className="size-4 text-emerald-600" strokeWidth={2.5} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-6xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            What people actually run
          </p>
          <h3 className="mt-3 max-w-xl text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
            Real tasks, real budgets.
          </h3>

          <div className="mt-8 grid grid-cols-1 gap-px border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            {EXAMPLE_TASKS.map((ex) => (
              <div key={ex.title} className="flex flex-col gap-3 bg-white p-7">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-[15px] font-semibold text-neutral-900">{ex.title}</h4>
                  <FileCheck2 className="mt-0.5 size-4 shrink-0 text-neutral-300" strokeWidth={1.75} />
                </div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
                  Budget: {ex.budget}
                </p>
                <p className="text-[12px] leading-relaxed text-neutral-500">{ex.pipeline}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-neutral-600">{ex.outcome}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-neutral-400">
            Example pipelines and budgets shown for illustration - the Manager composes the
            actual workforce and cost per task at run time.
          </p>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── SECURITY ─── */}
      <section id="security" className="py-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
              04 - Security
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
              Rogue agents don&apos;t move money.
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-500">
              An agent can request anything it wants. Only a deterministic
              policy - not an LLM, not a UI, not a promise - decides whether
              the ledger moves. Every check runs before the mutation, and a
              blocked transfer changes no balance.
            </p>
            <ul className="mt-8 space-y-3 font-mono text-[13px] text-neutral-600">
              {[
                "Scoped, per-task spend authorization",
                "Duplicate and expired-credential rejection",
                "Escrow cannot exceed authorized amount",
                "Blocked transfer ⇒ zero balance mutation",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 bg-neutral-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-neutral-300 shadow-[8px_8px_0_0_theme(colors.neutral.100)]">
            <div className="flex items-center gap-2 border-b border-neutral-300 bg-red-50 px-5 py-3">
              <ShieldAlert className="size-4 text-red-600" strokeWidth={2} />
              <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-red-700">
                Circuit breaker triggered
              </span>
            </div>
            <dl className="divide-y divide-neutral-200 font-mono text-[13px]">
              {[
                ["Agent", "atlas"],
                ["Requested", "10,000 tokens"],
                ["Authorized", "8 tokens"],
                ["Result", "BLOCKED"],
                ["Ledger", "UNCHANGED"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-5 py-3">
                  <dt className="text-neutral-400">{k}</dt>
                  <dd
                    className={
                      k === "Result"
                        ? "font-semibold text-red-600"
                        : k === "Ledger"
                          ? "font-semibold text-emerald-600"
                          : "text-neutral-900"
                    }
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── FINAL CTA ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="mx-auto max-w-2xl text-[26px] font-medium leading-[1.2] tracking-[-0.01em] text-neutral-900 sm:text-4xl lg:text-[2.6rem] xl:text-[2.9rem]">
            Put your workforce on a budget.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-neutral-500">
            Give Kraven a task and a hard limit. Watch it hire, verify, pay,
            and learn - inside a policy it cannot talk its way out of.
          </p>
          <Link
            href="/dashboard"
            onClick={handleLaunch}
            onMouseEnter={footerLaunch.onMouseEnter}
            onMouseLeave={footerLaunch.onMouseLeave}
            className="mt-9 inline-flex h-11 items-center gap-2 border border-neutral-900 bg-neutral-900 px-6 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            <ScrambleText text="Launch console" active={footerLaunch.hovered} />
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <ScaleDivider />

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-neutral-200 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <span className="font-mono text-[12px] text-neutral-400">© 2026 Kraven. All rights reserved.</span>
          <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            <FooterLinks linkClassName="transition-colors hover:text-neutral-700" />
          </div>
        </div>
      </footer>
    </div>
  );
}
