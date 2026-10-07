"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ScaleDivider, VerticalScaleBars } from "@/components/home/ScaleDivider";
import { SiteNavLinks } from "@/components/marketing/SiteNavLinks";
import { FooterLinks } from "@/components/marketing/FooterLinks";
import { MobileNav } from "@/components/marketing/MobileNav";
import { ThemeToggle } from "@/components/theme-toggle";

export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  // The app shell keeps <body> non-scrolling for the fixed-height dashboard;
  // marketing/legal pages need normal page scroll, same fix HomePage uses.
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "auto";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50 lg:px-4">
      <VerticalScaleBars />

      {/* ─── NAV ─── */}
      <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/logo.png"
              alt="Kraven"
              width={2172}
              height={724}
              className="h-9 w-auto dark:invert"
              priority
            />
          </Link>
          <nav className="hidden items-center gap-5 font-mono text-[10.5px] uppercase tracking-wider text-neutral-400 xl:flex dark:text-neutral-500">
            <SiteNavLinks linkClassName="transition-colors hover:text-neutral-900 dark:hover:text-white" />
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 items-center border border-neutral-300 px-3.5 font-mono text-[12px] uppercase tracking-wider text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-white dark:hover:text-white"
            >
              ← Home
            </Link>
            <ThemeToggle />
            <MobileNav />
          </div>
        </div>
      </header>

      {/* ─── CONTENT ─── */}
      <section className="py-16">
        <main className="mx-auto max-w-3xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Last updated {updated}
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
            {title}
          </h1>

          <div className="legal-prose mt-10 space-y-5 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
            {children}
          </div>
        </main>
      </section>

      <style>{`
        .legal-prose h2 {
          color: oklch(0.2 0 0);
          font-weight: 600;
          font-size: 1.15rem;
          letter-spacing: -0.01em;
          margin-top: 2.25rem;
          margin-bottom: 0.5rem;
        }
        .legal-prose h3 {
          color: oklch(0.3 0 0);
          font-weight: 600;
          font-size: 0.95rem;
          margin-top: 1.25rem;
          margin-bottom: 0.4rem;
        }
        .legal-prose p { margin-bottom: 0; }
        .legal-prose ul { list-style: disc; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
        .legal-prose li::marker { color: oklch(0.75 0 0); }
        .legal-prose a { color: oklch(0.2 0 0); text-underline-offset: 3px; text-decoration: underline; }
        .legal-prose a:hover { color: #000; }
        .legal-prose strong { color: oklch(0.2 0 0); font-weight: 600; }

        .dark .legal-prose h2 { color: oklch(0.96 0 0); }
        .dark .legal-prose h3 { color: oklch(0.88 0 0); }
        .dark .legal-prose li::marker { color: oklch(0.5 0 0); }
        .dark .legal-prose a { color: oklch(0.9 0 0); }
        .dark .legal-prose a:hover { color: #fff; }
        .dark .legal-prose strong { color: oklch(0.96 0 0); }
      `}</style>

      <ScaleDivider />

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-neutral-200 py-10 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <span className="font-mono text-[12px] text-neutral-400 dark:text-neutral-500">© 2026 Kraven. All rights reserved.</span>
          <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <FooterLinks linkClassName="transition-colors hover:text-neutral-700 dark:hover:text-neutral-300" />
          </div>
        </div>
      </footer>
    </div>
  );
}
